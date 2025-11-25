// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/src/Script.sol";
import {Vault} from "../src/Vault.sol";

contract DeployVaultScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address tokenAddress = vm.envAddress("TOKEN_ADDRESS");
        address executorAddress = vm.envAddress("EXECUTOR_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        address deployer = vm.addr(deployerPrivateKey);
        Vault vault = new Vault(tokenAddress, executorAddress, deployer);

        console.log("Vault deployed at:", address(vault));
        console.log("Token address:", tokenAddress);
        console.log("Executor address:", executorAddress);
        console.log("Owner address:", deployer);

        vm.stopBroadcast();
    }
}
