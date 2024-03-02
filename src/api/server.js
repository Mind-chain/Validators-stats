const ethers = require('ethers');
const axios = require('axios');
const level = require('level');
const express = require('express');
const { validator_abi } = require('../abi/validator.js');
const { erc20_abi } = require('../abi/erc20.js');
const { contracts, ws_rpc, blockcounterapi } = require('../const.js');

const app = express();
const port = 3000;

const provider = new ethers.providers.WebSocketProvider(ws_rpc);
const validatorContract = new ethers.Contract(contracts.validator, validator_abi, provider);
const rewardTokenContract = new ethers.Contract(contracts.Pmind, erc20_abi, provider);

const db = level('./data'); // Initialize LevelDB database

// Cache for storing validator data
const validatorCache = new Map();

// Fetches validator data and updates cache
async function fetchAndUpdateValidatorData(validator) {
    try {
        const [stake, rewards, statusData, counterData] = await Promise.all([
            validatorContract.accountStake(validator),
            rewardTokenContract.balanceOf(validator),
            axios.get(`${blockcounterapi}${validator}`),
            axios.get(`${blockcounterapi}${validator}/counters`)
        ]);

        const validatedBlocksStatus = statusData.data.has_validated_blocks ? "active" : "inactive";
        const validatedBlocksCount = counterData.data.validations_count || 0; // Default to 0 if no data is available

        // Fetch the human-readable name from the database
        const name = await db.get(validator).catch(() => null);

        // Prepare data for storage
        const data = {
            address: validator,
            name: name || '', // If no name is found, default to an empty string
            stake: ethers.utils.formatEther(stake) + " MIND",
            rewards: ethers.utils.formatEther(rewards) + " PMIND",
            validatedBlocksCount: validatedBlocksCount,
            validatedBlocksStatus: validatedBlocksStatus,
        };

        // Store data in cache
        validatorCache.set(validator, data);

        return data;
    } catch (error) {
        console.error('Error fetching validator data:', error);
        throw error;
    }
}

// Fetches validators data in parallel
async function fetchValidatorsData(validators) {
    try {
        const validatorData = await Promise.all(validators.map(fetchAndUpdateValidatorData));
        return validatorData;
    } catch (error) {
        console.error('Error fetching validators:', error);
        throw error;
    }
}

// Listen for new blocks and update validator data
provider.on('block', async (blockNumber) => {
    try {
        console.log(`New block received: ${blockNumber}, updating data...`);
        const validators = await validatorContract.validators();
        await fetchValidatorsData(validators);
    } catch (error) {
        console.error('Error updating validator data:', error);
    }
});

// Initial fetch and store
async function initialFetchAndStore() {
    try {
        console.log('Initial fetch and store...');
        const validators = await validatorContract.validators();
        await fetchValidatorsData(validators);
    } catch (error) {
        console.error('Error fetching and storing initial validator data:', error);
    }
}
initialFetchAndStore();

// Allow any origin to access the API
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Middleware to parse JSON data in the request body
app.use(express.json());

// API endpoint to add human-readable names for addresses
app.post('/addName', async (req, res) => {
    try {
        const { address, name } = req.body;
        await db.put(address, name);
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding name for address:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API endpoint to fetch validator data
app.get('/validators', async (req, res) => {
    try {
        console.log('Received HTTP request for validator data.');
        const validatorData = Array.from(validatorCache.values()).map(validator => {
            const { address, name, stake, rewards, validatedBlocksCount, validatedBlocksStatus } = validator;
            return { address, name, stake, rewards, validatedBlocksCount, validatedBlocksStatus };
        }).reverse();
        res.json(validatorData);
    } catch (error) {
        console.error('Error fetching validator data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
