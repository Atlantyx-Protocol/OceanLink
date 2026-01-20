// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Vault
 * @notice Manages internal balances for USDC and allows executor to perform batch transfers
 */
contract Vault is Ownable {
    IERC20 public immutable token;
    address public executor;

    mapping(address => uint256) public balances;

    struct Transfer {
        address from;
        address to;
        uint256 amount;
    }

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event TransferExecuted(address indexed from, address indexed to, uint256 amount);
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);

    constructor(address _token, address _executor, address _owner) Ownable(_owner) {
        require(_token != address(0), "Vault: token cannot be zero address");
        require(_executor != address(0), "Vault: executor cannot be zero address");
        token = IERC20(_token);
        executor = _executor;
    }

    /**
     * @notice Deposit USDC into the vault
     * @param amount Amount of tokens to deposit
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Vault: amount must be greater than zero");
        require(token.transferFrom(msg.sender, address(this), amount), "Vault: transfer failed");
        balances[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    /**
     * @notice Withdraw USDC from the vault
     * @param amount Amount of tokens to withdraw
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "Vault: amount must be greater than zero");
        require(balances[msg.sender] >= amount, "Vault: insufficient balance");
        balances[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount), "Vault: transfer failed");
        emit Withdraw(msg.sender, amount);
    }

    /**
     * @notice Execute a batch of internal transfers (only executor)
     * @param transfers Array of Transfer structs
     */
    function executeTransfers(Transfer[] calldata transfers) external {
        require(msg.sender == executor, "Vault: not authorized");
        require(transfers.length > 0, "Vault: transfers array is empty");

        for (uint256 i = 0; i < transfers.length; i++) {
            Transfer calldata t = transfers[i];
            require(t.from != address(0), "Vault: from cannot be zero address");
            require(t.to != address(0), "Vault: to cannot be zero address");
            require(t.amount > 0, "Vault: amount must be greater than zero");
            require(balances[t.from] >= t.amount, "Vault: insufficient balance");

            balances[t.from] -= t.amount;
            balances[t.to] += t.amount;

            emit TransferExecuted(t.from, t.to, t.amount);
        }
    }

    /**
     * @notice Update the executor address (only owner)
     * @param newExecutor New executor address
     */
    function setExecutor(address newExecutor) external onlyOwner {
        require(newExecutor != address(0), "Vault: executor cannot be zero address");
        address oldExecutor = executor;
        executor = newExecutor;
        emit ExecutorUpdated(oldExecutor, newExecutor);
    }
}
