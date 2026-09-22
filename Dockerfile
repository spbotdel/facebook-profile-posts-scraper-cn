FROM apify/actor-node:22

COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --no-audit --no-fund

COPY . ./
CMD npm start --silent
