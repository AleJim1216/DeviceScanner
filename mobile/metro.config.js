const http = require("http");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      const url = req.url || "";
      if (!url.startsWith("/model")) {
        return middleware(req, res, next);
      }

      const headers = { ...req.headers, host: "127.0.0.1:8000" };
      delete headers["transfer-encoding"];
      const proxy = http.request(
        {
          hostname: "127.0.0.1",
          port: 8000,
          path: url.slice("/model".length) || "/",
          method: req.method,
          headers,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxy.on("error", () => {
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain" });
        }
        res.end("Model server is not running on this computer.");
      });
      req.pipe(proxy);
    };
  },
};

module.exports = config;
