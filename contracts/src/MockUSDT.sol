// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT
 * @notice A simple mock USDT token for testing and development
 * @dev USDT uses 6 decimals
 */
contract MockUSDT is ERC20 {
    uint8 private constant DECIMALS = 6;

    constructor() ERC20("Tether USD", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
