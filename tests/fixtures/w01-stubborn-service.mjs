process.on("SIGTERM", () => {});
process.stdout.write("owned-stubborn-ready\n");
setInterval(() => {}, 1000);
