# 介绍人服务器。在仓库根目录构建：docker build -f apps/server/Dockerfile -t hutong-server .
FROM node:22-alpine
WORKDIR /srv
COPY apps/server/package.json apps/server/
RUN cd apps/server && npm install --omit=dev
COPY apps/server/src apps/server/src
COPY app app
ENV PORT=8080 MOBILE_DIR=/srv/app NODE_NO_WARNINGS=1
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "apps/server/src/main.ts"]
