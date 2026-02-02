
const io = require('socket.io-client');
const express = require('express');
const router = express.Router();
const AUTH_URL = process.env.AUTH_URL || 'http://localhost:4000/auth';

const socket = io("https://formbeta.yorktechapps.com/", {
    extraHeaders: {
        api: process.env.API_KEY || ''
    }
});




socket.on('connect', () => {
    console.log('Connected to server');
    
});

socket.on('transferResponse', (response) => {
    console.log('Transfer Response:', response);
    socket.disconnect();
});

socket.on('connect_error', (err) => {
    console.error('Connection Error:', err.message);
});

router.post('/api/digipogs/transfer', (req, res) => {
    const from = req.body.from;
    const to = req.body.to;
    const amount = req.body.amount;
    const reason = req.body.reason;
    const pin = req.body.pin;

    console.log(from, to, amount, reason, pin);

    const transferData = {
        from: from,
        to: to,
        amount: amount,
        reason: reason,
        pin: pin
    };
    // make a direct transfer request using fetch
    fetch(`${AUTH_URL}/api/digipogs/transfer`, {
        method: 'POST',
        // headers to specify json content
        headers: { 'Content-Type': 'application/json' },
        // stringify the transferData object to send as JSON
        body: JSON.stringify(transferData),
    }).then((transferResult) => {
        return transferResult.json();
    }).then((responseData) => {
        console.log("Transfer Response:", responseData);
        //res.JSON must be here to send the response back to the client
        res.json(responseData);
    }).catch(err => {
        console.error("Error during digipog transfer:", err);
        res.status(500).json({ message: 'Error during digipog transfer' });
    });
});

function purchase(price, reason, pin, amount) {
    fetch('/api/digipogs/transfer', {
        method: 'POST',
        // credentials include to send cookies
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            price: price,
            reason: `Pogglebar - ${reason}`,
            pin: pin
        })
    }).then(response => response.json())
        .then(data => {
            if (data.success) {
                // add purchased item effect here
                implement(price, reason, amount);
                save();
                alert(`Purchase successful! (-${price} Digipogs)`);
            } else {
                alert(`Purchase failed: ${data.message}`);
            }
        })
        .catch(err => {
            console.error("Error during purchase:", err);
        })
    };

module.exports = router;