const ethers = require('ethers');
const axios = require('axios');
const { validator_abi } = require('../abi/validator.js');
const { erc20_abi } = require('../abi/erc20.js');
const { contracts, ws_rpc, blockcounterapi } = require('../const.js');

const provider = new ethers.providers.WebSocketProvider(ws_rpc);
const validatorContract = new ethers.Contract(contracts.validator, validator_abi, provider);
const rewardTokenContract = new ethers.Contract(contracts.Pmind, erc20_abi, provider);
const API_ENDPOINT = '/validators';

async function fetchValidatorData(validator) {
    const [stake, rewards, statusData, counterData] = await Promise.all([
        validatorContract.accountStake(validator),
        rewardTokenContract.balanceOf(validator),
        axios.get(`${blockcounterapi}${validator}`),
        axios.get(`${blockcounterapi}${validator}/counters`)
    ]);

    const validatedBlocksStatus = statusData.data.has_validated_blocks ? "active" : "inactive";
    const validatedBlocksCount = counterData.data.validations_count || 0; // Default to 0 if no data is available
    return {
        address: validator,
        stake: ethers.utils.formatEther(stake) + " MIND",
        rewards: ethers.utils.formatEther(rewards) + " PMIND",
        validatedBlocksCount: validatedBlocksCount,
        validatedBlocksStatus: validatedBlocksStatus,
    };
}

async function fetchValidators() {
    const validators = await validatorContract.validators();
    const promises = validators.map(fetchValidatorData);

    return await Promise.all(promises);
}

const express = require('express');
const app = express();
const port = 3000;

app.get(API_ENDPOINT, async (req, res) => {
    try {
        console.log('Received HTTP request for validator data.'); // Added log statement
        const validatorData = await fetchValidators();
        res.json(validatorData);
    } catch (error) {
        console.error('Error fetching validator data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
