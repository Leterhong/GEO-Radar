#!/bin/sh
set -e
# 启动前执行数据库迁移（幂等）；不允许静默重置数据库
echo "[geo-radar] applying database migrations..."
node ./node_modules/prisma/build/index.js migrate deploy
echo "[geo-radar] starting server..."
exec node server.js
