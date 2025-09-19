import dotenv from 'dotenv'; // Import the dotenv module (environment variable management)
dotenv.config(); // Load environment variables from .env file 

import app from './app'; // Import the Express app

const PORT = process.env.PORT || 3000; // Port from environment variables (default is 3000) 

app.listen(PORT, () =>{
    console.log(`The server is running at ${PORT}`); // Log the port the server is running at
})