FROM node:20-slim

RUN apt-get update \
    && apt-get install -y wget gnupg ca-certificates fonts-liberation libasound2 \
       libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libgdk-pixbuf2.0-0 \
       libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
       libgbm1 libgtk-3-0 xdg-utils libxshmfence1 chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 8080
CMD ["node", "server.js"]
