// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/src/Script.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

contract DeployMockUSDTScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        address deployer = vm.addr(deployerPrivateKey);
        MockUSDT mockUSDT = new MockUSDT();

        // Mint 1,000,000 USDT (6 decimals) to deployer
        uint256 mintAmount = 1_000_000e6;
        mockUSDT.mint(deployer, mintAmount);

        console.log("MockUSDT deployed at:", address(mockUSDT));
        console.log("Deployer address:", deployer);
        console.log("Token name:", mockUSDT.name());
        console.log("Token symbol:", mockUSDT.symbol());
        console.log("Token decimals:", mockUSDT.decimals());
        console.log("Minted amount:", mintAmount);
        console.log("Deployer balance:", mockUSDT.balanceOf(deployer));

        vm.stopBroadcast();
    }
}
