FROM node:20

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 3000
EXPOSE 40000-49999/udp

# Chạy server
CMD ["node", "server.js"]
