const app = require("./index")
if (typeof app.listen !== "function") throw new Error("no app")
console.log("1 passed")
