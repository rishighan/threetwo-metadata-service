# Use Node 21 as the base image for the builder stage
FROM node:21-alpine AS builder
LABEL maintainer="Rishi Ghan <rishi.ghan@gmail.com>"

# Set the working directory
WORKDIR /metadata-service

# Copy and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --silent

# Copy source code and build the application
COPY . .
RUN npm run build

# Clean up development dependencies
RUN npm prune --production

# Final image using Node 21
FROM node:21-alpine

LABEL maintainer="Rishi Ghan <rishi.ghan@gmail.com>"

# Set the working directory
WORKDIR /metadata-service

# Copy the necessary files from the builder image
COPY --from=builder /metadata-service /metadata-service

# Set environment variables
ENV NODE_ENV=production

# Expose the application's port
EXPOSE 3080

# Start the application
CMD ["npm", "start"]
