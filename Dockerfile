FROM node:20

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

ENV MCP_TRANSPORT=http
ENV HOST=0.0.0.0
ENV PORT=3000

CMD ["node", "src/index.js", "--http"]
