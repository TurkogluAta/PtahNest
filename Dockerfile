FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

EXPOSE 3000
# SSL is handled by Nginx on the host, not by Node.js

CMD ["node", "./bin/www"]
