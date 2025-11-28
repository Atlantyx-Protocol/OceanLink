// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/src/Script.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

contract MintUSDTScript is Script {
    // User addresses
    address constant USER_A = 0x9B55124d945B6E61c521adD7aA213433b3b1c8a2;
    address constant USER_B = 0x3ACa6E32BD6268ba2b834e6F23405e10575d19B2;
    address constant USER_C = 0x7CB386178D13e21093FDc988C7e77102D6464F3E;
    address constant USER_D = 0xE08745df99d3563821b633aA93Ee02F7F883F25c;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address tokenAddress = vm.envAddress("TOKEN_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        MockUSDT token = MockUSDT(tokenAddress);
        uint256 mintAmount = 1_000_000_000e6; // 1 billion USDT (6 decimals)

        // Mint to A
        token.mint(USER_A, mintAmount);
        console.log("Minted", mintAmount, "USDT to A:", USER_A);
        console.log("A balance:", token.balanceOf(USER_A));

        // Mint to B
        token.mint(USER_B, mintAmount);
        console.log("Minted", mintAmount, "USDT to B:", USER_B);
        console.log("B balance:", token.balanceOf(USER_B));

        // Mint to C
        token.mint(USER_C, mintAmount);
        console.log("Minted", mintAmount, "USDT to C:", USER_C);
        console.log("C balance:", token.balanceOf(USER_C));

        // Mint to D
        token.mint(USER_D, mintAmount);
        console.log("Minted", mintAmount, "USDT to D:", USER_D);
        console.log("D balance:", token.balanceOf(USER_D));

        vm.stopBroadcast();
    }
}
