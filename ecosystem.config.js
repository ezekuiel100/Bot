module.exports = {
  apps: [
    {
      name: "bot",
      script: "main.js",
      node_args: "--env-file=.env",
    },
    {
      name: "web",
      script: "server.js",
      node_args: "--env-file=.env",
    },
  ],
};
