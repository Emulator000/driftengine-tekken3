# The online matches' server on its own: docker build -t tekken3-relay server && docker run -p 8790:8790 tekken3-relay
FROM node:22-alpine
WORKDIR /relay
COPY package.json relay.mjs panel.mjs ./
RUN npm install --omit=dev --no-audit --no-fund
USER node
EXPOSE 8790
CMD ["node", "relay.mjs"]
