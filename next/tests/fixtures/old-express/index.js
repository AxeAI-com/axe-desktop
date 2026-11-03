const express = require("express")
const app = express()
app.get("/", (req, res) => res.send("Shop"))
module.exports = app
