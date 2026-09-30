import { app } from "./app";
import { env } from "./config/env";

app.listen(env.PORT, env.HOST, () => {
  console.log(`API listening on http://${env.HOST}:${env.PORT}`);
});
