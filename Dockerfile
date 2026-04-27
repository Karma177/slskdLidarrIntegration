FROM node:23-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install dependencies
RUN npm install

# Bundle app source
COPY . .

# Expose the web server port (default 8080)
EXPOSE 8080

# Command to run the application
CMD [ "npm", "start" ]