const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;



app.get('/', (req, res) => {
    res.send('CureMedix server is healing you entirely!!')
});


app.listen(port, () => {
    console.log(`CureMedix server is running on PORT: ${port}`)
});