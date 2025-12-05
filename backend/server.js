import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mediasoup from 'mediasoup';
import dotenv from 'dotenv'
import cookieParser from 'cookie-parser'
dotenv.config()


const app = express();

app.use(express.json({limit : "50mb"})); // -> Biến dữ liệu ở phần body thành dạng json -> Ở đây có note lỗi bên dưới nhớ đừng tái phạm
app.use(express.urlencoded({ extended: true })); // -> Biến form từ Dạng String hoặc multipart khi có ảnh thành dạng json
app.use(cookieParser());

const PORT = process.env.PORT || 3000;


const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

console.log('PUBLICURL');

let worker, router;

const peers = {}; 
// peers = { socketId: { transports:[], producers:{}, consumers:{}, name } }

async function createWorker() {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  });
  
  router = await worker.createRouter({
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
      { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
    ],
  });
  
  console.log('✅ Mediasoup worker & router ready');
}
await createWorker();

io.on('connection', socket => {
  console.log('🔌 New connection:', socket.id);
  
  peers[socket.id] = {
    transports: [],
    producers: {},
    consumers: {},
    name: null,
  };

  // ---------------- Register ----------------
  socket.on('register', ({ name }) => {
    peers[socket.id].name = name;
    console.log('👤 User registered:', name, socket.id);
    
    io.emit('users', Object.entries(peers)
      .filter(([id, p]) => p.name)
      .map(([id, p]) => ({ id, name: p.name }))
    );
  });

  socket.on('get-users', () => {
    socket.emit('users', Object.entries(peers)
      .filter(([id, p]) => p.name)
      .map(([id, p]) => ({ id, name: p.name }))
    );
  });

  // ---------------- Signaling 1-1 ----------------
  socket.on('call-user', ({ targetId }) => {
    console.log('📞 Call from', socket.id, 'to', targetId);
    io.to(targetId).emit('incoming-call', { 
      from: socket.id, 
      name: peers[socket.id].name 
    });
  });

  socket.on('answer-call', ({ callerId, accept }) => {
    console.log('📱 Call answered:', accept, 'by', socket.id);
    io.to(callerId).emit('call-answered', { 
      accept, 
      answerId: socket.id 
    });
  });

  socket.on('end-call', ({ targetId }) => {
    console.log('📴 Call ended by', socket.id, 'to', targetId);
    io.to(targetId).emit('call-ended');
  });

  // ---------------- Mediasoup: capability ----------------
  socket.on('getRouterRtpCapabilities', (_, cb) => {
    cb(router.rtpCapabilities);
  });

  // ---------------- Create Transport ----------------
  socket.on('createWebRtcTransport', async (_, cb) => {
    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp: "3.107.113.40" }],
        enableUdp: true, // Do render ko có cổng Udp nên tạm command lại ưu tiên tcp
        enableTcp: true,
        preferUdp: true, // Do render ko có cổng Udp nên tạm command lại ưu tiên tcp
      });

      peers[socket.id].transports.push(transport);
      console.log('🚚 Transport created:', transport.id, 'for', socket.id);

      cb({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (error) {
      console.error('❌ Error creating transport:', error);
      cb({ error: error.message });
    }
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters }, cb) => {
    try {
      const transport = peers[socket.id].transports.find(t => t.id === transportId);
      if (!transport) {
        console.error('❌ Transport not found:', transportId);
        return cb({ error: 'Transport not found' });
      }
      
      await transport.connect({ dtlsParameters });
      console.log('✅ Transport connected:', transportId);
      cb();
    } catch (error) {
      console.error('❌ Error connecting transport:', error);
      cb({ error: error.message });
    }
  });

  // ---------------- Produce track ----------------
  socket.on('produce', async ({ transportId, kind, rtpParameters, notifyPeerId }, cb) => {
    try {
      const transport = peers[socket.id].transports.find(t => t.id === transportId);
      if (!transport) {
        console.error('❌ Transport not found for produce:', transportId);
        return cb({ error: 'Transport not found' });
      }

      const producer = await transport.produce({ kind, rtpParameters });

      // Đóng producer cũ nếu có (để handle replace track)
      if (peers[socket.id].producers[kind]) {
        peers[socket.id].producers[kind].close();
      }
      
      peers[socket.id].producers[kind] = producer;
      console.log('🎥 Produced', kind, 'track:', producer.id, 'by', socket.id);

      // Notify specific peer nếu có (cho screen share / camera switch)
      if (notifyPeerId && peers[notifyPeerId]) {
        console.log(`📢 Notifying ${notifyPeerId} about new ${kind} producer:`, producer.id);
        io.to(notifyPeerId).emit('producer-replaced', { 
          kind, 
          producerId: producer.id,
          producerSocketId: socket.id 
        });
      }

      cb({ id: producer.id });
    } catch (error) {
      console.error('❌ Error producing:', error);
      cb({ error: error.message });
    }
  });

  // ---------------- Consumer request ----------------
  socket.on('getProducer', ({ targetId }, cb) => {
    const target = peers[targetId];
    if (!target) {
      console.log('⚠️  Target not found:', targetId);
      return cb(null);
    }

    const video = target.producers.video?.id;
    const audio = target.producers.audio?.id;

    console.log('🔍 Get producer from', targetId, '- video:', video, 'audio:', audio);
    cb({ video, audio });
  });

  socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, cb) => {
    try {
      if (!router.canConsume({ producerId, rtpCapabilities })) {
        console.log('⚠️  Cannot consume:', producerId);
        return cb({ error: 'Cannot consume' });
      }

      const transport = peers[socket.id].transports.find(t => t.id === transportId);
      if (!transport) {
        console.error('❌ Transport not found for consume:', transportId);
        return cb({ error: 'Transport not found' });
      }

      const consumer = await transport.consume({ 
        producerId, 
        rtpCapabilities, 
        paused: false 
      });
      
      peers[socket.id].consumers[consumer.kind] = consumer;
      console.log('🔊 Consumed', consumer.kind, 'track:', consumer.id, 'by', socket.id);

      cb({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (error) {
      console.error('❌ Error consuming:', error);
      cb({ error: error.message });
    }
  });

  // ---------------- Disconnect ----------------
  socket.on('disconnect', () => {
    console.log('👋 User disconnected:', socket.id);
    
    if (peers[socket.id]) {
      // Close all transports
      for (const t of peers[socket.id].transports) {
        t.close();
      }
      
      // Close all producers
      for (const p of Object.values(peers[socket.id].producers)) {
        p.close();
      }
      
      // Close all consumers
      for (const c of Object.values(peers[socket.id].consumers)) {
        c.close();
      }
      
      delete peers[socket.id];
    }

    // Broadcast updated user list
    io.emit('users', Object.entries(peers)
      .filter(([id, p]) => p.name)
      .map(([id, p]) => ({ id, name: p.name }))
    );
  });
});


server.listen(PORT,"0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});