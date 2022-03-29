FROM node:12-alpine
LABEL maintainer="Rishi Ghan <rishi.ghan@gmail.com>"

# Working directory
WORKDIR /metadata-service
# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --silent

# Copy source
COPY . .

# Build and cleanup
ENV NODE_ENV=production
RUN npm run build \
 && npm prune

EXPOSE 3080
# Start server
CMD ["npm", "start"]