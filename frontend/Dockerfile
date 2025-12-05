# 1️⃣ Build stage
FROM node:20 AS build

WORKDIR /usr/src/app

# Copy package.json & lock
COPY package*.json ./

# Cài dependencies
RUN npm install

# Copy toàn bộ source
COPY . .

# Build project
RUN npm run build

# 2️⃣ Production stage (serve bằng nginx)
FROM nginx:alpine

# Copy folder build sang nginx html
COPY --from=build /usr/src/app/dist /usr/share/nginx/html

# Copy config nginx nếu muốn custom (tuỳ)
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Chạy nginx
CMD ["nginx", "-g", "daemon off;"]
