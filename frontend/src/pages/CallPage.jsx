import React, { useEffect, useRef, useState } from "react";
import { socket } from "../socket";
import * as mediasoupClient from "mediasoup-client";
import { useParams, useNavigate } from "react-router-dom";

export default function CallPage() {
  const { targetId } = useParams();
  const navigate = useNavigate();

  const localVideo = useRef();
  const remoteVideo = useRef();

  const deviceRef = useRef();
  const sendTransportRef = useRef();
  const recvTransportRef = useRef();

  const localStreamRef = useRef(null);
  const videoProducerRef = useRef(null);
  const audioProducerRef = useRef(null);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const screenStreamRef = useRef(null);
  const originalVideoTrackRef = useRef(null);

  useEffect(() => {
    if (!isInitialized) {
      startMediasoup();
      setIsInitialized(true);
    }

    socket.on("call-ended", () => {
      console.log("📴 Call ended by remote");
      cleanup();
      navigate("/home");
    });

    // Handle khi remote peer replace producer (screen share / camera switch)
    socket.on("producer-replaced", async ({ kind, producerId, producerSocketId }) => {
      console.log("🔄 Remote producer replaced:", kind, producerId);
      
      if (!recvTransportRef.current) {
        console.log("⚠️ Recv transport not ready yet");
        return;
      }

      try {
        // Consume producer mới
        const result = await new Promise(res =>
          socket.emit(
            "consume",
            {
              transportId: recvTransportRef.current.id,
              producerId: producerId,
              rtpCapabilities: deviceRef.current.rtpCapabilities,
            },
            res
          )
        );

        if (result.error) {
          console.error("❌ Error consuming replaced producer:", result.error);
          return;
        }

        const newConsumer = await recvTransportRef.current.consume(result);
        
        // Update remote video stream với track mới
        const remoteStream = remoteVideo.current.srcObject;
        
        // Remove old track của cùng loại
        const oldTracks = remoteStream.getTracks().filter(t => t.kind === kind);
        oldTracks.forEach(t => {
          remoteStream.removeTrack(t);
          t.stop();
        });
        
        // Add track mới
        remoteStream.addTrack(newConsumer.track);
        
        console.log("✅ Remote stream updated with new", kind, "track");
      } catch (error) {
        console.error("❌ Error handling producer replacement:", error);
      }
    });

    return () => {
      socket.off("call-ended");
      socket.off("producer-replaced");
      cleanup();
    };
  }, []);

  // -------------------------
  const startMediasoup = async () => {
    try {
      console.log("🚀 Starting mediasoup...");

      // 1. Get router capabilities
      const routerRtp = await new Promise(res =>
        socket.emit("getRouterRtpCapabilities", null, res)
      );

      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: routerRtp });
      deviceRef.current = device;
      console.log("✅ Device loaded");

      // 2. Create send transport
      const sendData = await new Promise(res =>
        socket.emit("createWebRtcTransport", {}, res)
      );

      if (sendData.error) {
        throw new Error(sendData.error);
      }

      const sendTransport = device.createSendTransport(sendData);
      sendTransportRef.current = sendTransport;

      sendTransport.on("connect", ({ dtlsParameters }, cb, errback) => {
        socket.emit(
          "connectTransport",
          { transportId: sendTransport.id, dtlsParameters },
          (response) => {
            if (response?.error) {
              errback(new Error(response.error));
            } else {
              cb();
            }
          }
        );
      });

      sendTransport.on("produce", ({ kind, rtpParameters }, cb, errback) => {
        socket.emit(
          "produce",
          { 
            transportId: sendTransport.id, 
            kind, 
            rtpParameters,
            notifyPeerId: targetId // Notify remote peer về producer mới
          },
          (response) => {
            if (response?.error) {
              errback(new Error(response.error));
            } else {
              cb({ id: response.id });
            }
          }
        );
      });

      console.log("✅ Send transport created");

      // 3. Get local stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      localVideo.current.srcObject = stream;
      console.log("✅ Local stream ready");

      // Save original video track for screen share toggle
      originalVideoTrackRef.current = stream.getVideoTracks()[0];

      // 4. Produce video + audio
      videoProducerRef.current = await sendTransport.produce({
        track: stream.getVideoTracks()[0],
      });

      audioProducerRef.current = await sendTransport.produce({
        track: stream.getAudioTracks()[0],
      });

      console.log("✅ Produced local tracks");

      // 5. Get producer from target
      await consumeRemoteStream();

    } catch (error) {
      console.error("❌ Error starting mediasoup:", error);
      alert("Lỗi khi khởi tạo cuộc gọi: " + error.message);
      navigate("/home");
    }
  };

  const consumeRemoteStream = async () => {
    try {
      // Wait a bit for remote peer to setup
      await new Promise(resolve => setTimeout(resolve, 500));

      const { video, audio } = await new Promise(res =>
        socket.emit("getProducer", { targetId }, res)
      );

      console.log("🔍 Remote producers - video:", video, "audio:", audio);

      if (!video && !audio) {
        console.log("⚠️  No remote producers yet, will retry...");
        // Retry after 1 second
        setTimeout(consumeRemoteStream, 1000);
        return;
      }

      // Create recv transport
      const recvData = await new Promise(res =>
        socket.emit("createWebRtcTransport", {}, res)
      );

      if (recvData.error) {
        throw new Error(recvData.error);
      }

      const recvTransport = deviceRef.current.createRecvTransport(recvData);
      recvTransportRef.current = recvTransport;

      recvTransport.on("connect", ({ dtlsParameters }, cb, errback) => {
        socket.emit(
          "connectTransport",
          { transportId: recvTransport.id, dtlsParameters },
          (response) => {
            if (response?.error) {
              errback(new Error(response.error));
            } else {
              cb();
            }
          }
        );
      });

      console.log("✅ Recv transport created");

      const remoteStream = new MediaStream();

      // Consume video
      if (video) {
        const v = await new Promise(res =>
          socket.emit(
            "consume",
            {
              transportId: recvTransport.id,
              producerId: video,
              rtpCapabilities: deviceRef.current.rtpCapabilities,
            },
            res
          )
        );

        if (v.error) {
          console.error("❌ Error consuming video:", v.error);
        } else {
          const videoConsumer = await recvTransport.consume(v);
          remoteStream.addTrack(videoConsumer.track);
          console.log("✅ Video track consumed");
        }
      }

      // Consume audio
      if (audio) {
        const a = await new Promise(res =>
          socket.emit(
            "consume",
            {
              transportId: recvTransport.id,
              producerId: audio,
              rtpCapabilities: deviceRef.current.rtpCapabilities,
            },
            res
          )
        );

        if (a.error) {
          console.error("❌ Error consuming audio:", a.error);
        } else {
          const audioConsumer = await recvTransport.consume(a);
          remoteStream.addTrack(audioConsumer.track);
          console.log("✅ Audio track consumed");
        }
      }

      remoteVideo.current.srcObject = remoteStream;
      console.log("✅ Remote stream ready");

    } catch (error) {
      console.error("❌ Error consuming remote stream:", error);
    }
  };

  // --------------------- ACTIONS ----------------------

  const toggleMic = () => {
    if (!localStreamRef.current) return;
    
    const track = localStreamRef.current.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMicOn(track.enabled);
      console.log("🎤 Mic:", track.enabled ? "ON" : "OFF");
    }
  };

  const toggleCam = () => {
    if (!localStreamRef.current) return;
    
    const track = localStreamRef.current.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCamOn(track.enabled);
      console.log("📹 Camera:", track.enabled ? "ON" : "OFF");
    }
  };

  const shareScreen = async () => {
    try {
      if (isScreenSharing) {
        // Stop screen sharing, back to camera
        await stopScreenShare();
        return;
      }

      console.log("🖥️  Starting screen share...");
      
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true 
      });
      
      const screenTrack = screenStream.getVideoTracks()[0];
      screenStreamRef.current = screenStream;

      // Close old video producer
      if (videoProducerRef.current) {
        videoProducerRef.current.close();
      }

      // Create NEW producer with screen track
      videoProducerRef.current = await sendTransportRef.current.produce({
        track: screenTrack,
      });
      
      // Update local video
      const newStream = new MediaStream([
        screenTrack,
        localStreamRef.current.getAudioTracks()[0]
      ]);
      localVideo.current.srcObject = newStream;

      setIsScreenSharing(true);
      console.log("✅ Screen sharing started with new producer");

      // Handle when user stops sharing via browser UI
      screenTrack.onended = async () => {
        console.log("🛑 Screen share ended by user");
        await stopScreenShare();
      };

    } catch (error) {
      console.error("❌ Error sharing screen:", error);
      alert("Không thể chia sẻ màn hình");
    }
  };

  const stopScreenShare = async () => {
    try {
      if (!isScreenSharing) return;

      console.log("🛑 Stopping screen share...");

      // Stop screen stream
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }

      // Close old video producer
      if (videoProducerRef.current) {
        videoProducerRef.current.close();
      }

      // Get NEW camera stream (fresh getUserMedia)
      const newCameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false // chỉ lấy video, audio giữ nguyên
      });

      const newCameraTrack = newCameraStream.getVideoTracks()[0];
      
      // Create NEW producer with camera track
      videoProducerRef.current = await sendTransportRef.current.produce({
        track: newCameraTrack,
      });

      // Update local stream reference
      const oldAudioTrack = localStreamRef.current.getAudioTracks()[0];
      localStreamRef.current = new MediaStream([newCameraTrack, oldAudioTrack]);
      
      // Update video refs
      originalVideoTrackRef.current = newCameraTrack;
      localVideo.current.srcObject = localStreamRef.current;

      setIsScreenSharing(false);
      console.log("✅ Back to camera with new producer");

    } catch (error) {
      console.error("❌ Error stopping screen share:", error);
      alert("Không thể quay lại camera");
    }
  };

  const endCall = () => {
    console.log("📴 Ending call...");
    socket.emit("end-call", { targetId });
    cleanup();
    navigate("/home");
  };

  const cleanup = () => {
    console.log("🧹 Cleaning up...");

    // Stop all local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }

    // Stop screen share if active
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
    }

    // Close producers
    if (videoProducerRef.current) {
      videoProducerRef.current.close();
      videoProducerRef.current = null;
    }
    
    if (audioProducerRef.current) {
      audioProducerRef.current.close();
      audioProducerRef.current = null;
    }

    // Close transports
    if (sendTransportRef.current) {
      sendTransportRef.current.close();
      sendTransportRef.current = null;
    }
    
    if (recvTransportRef.current) {
      recvTransportRef.current.close();
      recvTransportRef.current = null;
    }
  };

  // --------------------- UI ----------------------
  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h2>🎥 Cuộc gọi đang diễn ra...</h2>

      <div style={{ 
        display: "flex", 
        gap: 20, 
        marginBottom: 20,
        flexWrap: "wrap" 
      }}>
        <div style={{ position: "relative" }}>
          <video 
            ref={localVideo} 
            autoPlay 
            muted 
            style={{ 
              width: 400, 
              height: 300, 
              backgroundColor: "#000",
              borderRadius: 8,
              objectFit: "cover"
            }} 
          />
          <div style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            background: "rgba(0,0,0,0.7)",
            color: "white",
            padding: "5px 10px",
            borderRadius: 5,
            fontSize: 12
          }}>
            You {isScreenSharing ? "(Screen)" : ""}
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <video 
            ref={remoteVideo} 
            autoPlay 
            style={{ 
              width: 400, 
              height: 300, 
              backgroundColor: "#222",
              borderRadius: 8,
              objectFit: "cover"
            }} 
          />
          <div style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            background: "rgba(0,0,0,0.7)",
            color: "white",
            padding: "5px 10px",
            borderRadius: 5,
            fontSize: 12
          }}>
            Remote
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button 
          onClick={toggleMic}
          style={{
            padding: "10px 20px",
            backgroundColor: micOn ? "#4CAF50" : "#f44336",
            color: "white",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 14
          }}
        >
          {micOn ? "🎤 Mic On" : "🔇 Mic Off"}
        </button>

        <button 
          onClick={toggleCam}
          style={{
            padding: "10px 20px",
            backgroundColor: camOn ? "#4CAF50" : "#f44336",
            color: "white",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 14
          }}
        >
          {camOn ? "📹 Cam On" : "📹 Cam Off"}
        </button>

        <button 
          onClick={shareScreen}
          style={{
            padding: "10px 20px",
            backgroundColor: isScreenSharing ? "#FF9800" : "#2196F3",
            color: "white",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 14
          }}
        >
          {isScreenSharing ? "🛑 Stop Share" : "🖥️  Share Screen"}
        </button>

        <button
          onClick={endCall}
          style={{
            padding: "10px 20px",
            backgroundColor: "#d32f2f",
            color: "white",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: "bold"
          }}
        >
          📞 End Call
        </button>
      </div>
    </div>
  );
}