# Base image
FROM node:20-alpine

# Define variables
ARG APP_NAME

# Create app directory
WORKDIR /usr/src/app

COPY package.json yarn.lock ./

RUN corepack enable && yarn install --frozen-lockfile

# Bundle app source
COPY . .

# Creates a "dist" folder with the production build
RUN yarn run build -- ${APP_NAME}

ENV NODE_ENV=production

# Start the server using the production build
CMD [ "node", "dist/apps/${APP_NAME}/main.js" ]