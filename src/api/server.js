const axios = require('axios');
const ethers = require('ethers');
const level = require('level');
const express = require('express');
const WebSocket = require('ws');
const { validator_abi } = require('../abi/validator.js');
const { erc20_abi } = require('../abi/erc20.js');
const { contracts, ws_rpc, blockcounterapi } = require('../const.js');
const { cns_abi } = require('../abi/cns_abi.js');

const app = express();
const port = 8000;

const st_provider = new ethers.providers.WebSocketProvider(ws_rpc);

const validatorContract = new ethers.Contract(contracts.validator, validator_abi, st_provider);
const rewardTokenContract = new ethers.Contract(contracts.Pmind, erc20_abi, st_provider);

const db = level('./data'); // Initialize LevelDB database

// Cache for storing validator data
const validatorCache = new Map();

// Fetches validator data and updates cache
async function fetchAndUpdateValidatorData(validator) {
    try {
        const [stake, rewards, statusData] = await Promise.all([
            validatorContract.accountStake(validator),
            rewardTokenContract.balanceOf(validator),
            axios.get(`${blockcounterapi}${validator}`)
        ]);

        const validatedBlocksStatus = statusData.data.has_validated_blocks ? "active" : "inactive";

        // Fetch the human-readable name from the database
        const name = await db.get(validator).catch(() => null);

        // Prepare data for storage
        const data = {
            address: validator,
            name: name || '', // If no name is found, default to an empty string
            stake: ethers.utils.formatEther(stake) + " MIND",
            rewards: ethers.utils.formatEther(rewards) + " PMIND",
            validatedBlocksCount: statusData.data.validations_count || 0, // Default to 0 if no data is available
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
st_provider.on('block', async (blockNumber) => {
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

        // Check if the name already exists for the address
        const existingName = await db.get(address).catch(() => null);
        if (existingName) {
            return res.status(400).json({ error: 'Name already exists for this address' });
        }

        // If the name doesn't exist, add it to the database
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

// Function to fetch total staked amount directly from the contract
async function fetchTotalStakedAmount() {
    try {
        const totalStakedAmount = await validatorContract.stakedAmount();
        return ethers.utils.formatEther(totalStakedAmount) + " MIND";
    } catch (error) {
        console.error('Error fetching total staked amount:', error);
        throw error;
    }
}

// Contract instance for BlockchainInfo
const blockchainInfoContract = new ethers.Contract(contracts.blockchainInfoAddress, cns_abi, st_provider);

// Function to fetch current block epoch from BlockchainInfo contract
async function fetchCurrentBlockEpoch() {
    try {
        const currentBlockEpoch = await blockchainInfoContract.getCurrentBlockEpoch();
        return parseInt(currentBlockEpoch, 16).toString();
    } catch (error) {
        console.error('Error fetching current block epoch:', error);
        throw error;
    }
}

// Function to count total validator addresses from LevelDB
async function countTotalValidatorAddresses() {
    try {
        const totalAddresses = validatorCache.size;
        console.log('Total validator addresses counted:', totalAddresses);
        return totalAddresses;
    } catch (error) {
        console.error('Error counting total validator addresses:', error);
        throw error;
    }
}

app.get('/chaindata', async (req, res) => {
    try {
        console.log('Received HTTP request for chain data.');
        const currentBlockEpoch = await fetchCurrentBlockEpoch();
        const totalStakedAmount = await fetchTotalStakedAmount();
        const totalValidatorAddresses = await countTotalValidatorAddresses();
        res.json({ currentBlockEpoch, totalStakedAmount, totalValidatorAddresses });
    } catch (error) {
        console.error('Error fetching chain data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
