import { throttle } from "lodash";

// This is a UI-style debounce utility, not an HTTP rate limiter. It has
// nothing to do with express or per-client request limits.
const onScroll = throttle(() => console.log("scrolled"), 200);

app.get("/health", (req, res) => res.send("ok"));
app.get("/items", (req, res) => res.json([]));
