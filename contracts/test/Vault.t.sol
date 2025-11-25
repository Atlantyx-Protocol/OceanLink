// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/src/Test.sol";
import {Vault} from "../src/Vault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VaultTest is Test {
    Vault public vault;
    MockERC20 public token;
    address public executor;
    address public owner;
    address public user1;
    address public user2;
    address public user3;

    function setUp() public {
        owner = address(this);
        executor = address(0x1234);
        user1 = address(0x1);
        user2 = address(0x2);
        user3 = address(0x3);

        token = new MockERC20("USD Coin", "USDC");
        vault = new Vault(address(token), executor, owner);
    }

    function test_Deposit() public {
        uint256 amount = 1000e6; // 1000 USDC (6 decimals)
        token.mint(user1, amount);
        vm.prank(user1);
        token.approve(address(vault), amount);

        vm.prank(user1);
        vault.deposit(amount);

        assertEq(vault.balances(user1), amount);
        assertEq(token.balanceOf(address(vault)), amount);
        assertEq(token.balanceOf(user1), 0);
    }

    function test_DepositFailsIfZeroAmount() public {
        uint256 amount = 1000e6;
        token.mint(user1, amount);
        vm.prank(user1);
        token.approve(address(vault), amount);

        vm.prank(user1);
        vm.expectRevert("Vault: amount must be greater than zero");
        vault.deposit(0);
    }

    function test_Withdraw() public {
        uint256 depositAmount = 1000e6;
        uint256 withdrawAmount = 500e6;

        token.mint(user1, depositAmount);
        vm.prank(user1);
        token.approve(address(vault), depositAmount);

        vm.prank(user1);
        vault.deposit(depositAmount);

        vm.prank(user1);
        vault.withdraw(withdrawAmount);

        assertEq(vault.balances(user1), depositAmount - withdrawAmount);
        assertEq(token.balanceOf(address(vault)), depositAmount - withdrawAmount);
        assertEq(token.balanceOf(user1), withdrawAmount);
    }

    function test_WithdrawFailsIfInsufficientBalance() public {
        uint256 amount = 1000e6;
        token.mint(user1, amount);
        vm.prank(user1);
        token.approve(address(vault), amount);

        vm.prank(user1);
        vault.deposit(amount);

        vm.prank(user1);
        vm.expectRevert("Vault: insufficient balance");
        vault.withdraw(amount + 1);
    }

    function test_ExecuteTransfers() public {
        uint256 amount1 = 1000e6;
        uint256 amount2 = 500e6;

        // Setup: user1 and user2 deposit
        token.mint(user1, amount1);
        token.mint(user2, amount2);

        vm.prank(user1);
        token.approve(address(vault), amount1);
        vm.prank(user2);
        token.approve(address(vault), amount2);

        vm.prank(user1);
        vault.deposit(amount1);
        vm.prank(user2);
        vault.deposit(amount2);

        // Execute transfer: user1 -> user2
        uint256 transferAmount = 300e6;
        Vault.Transfer[] memory transfers = new Vault.Transfer[](1);
        transfers[0] = Vault.Transfer({from: user1, to: user2, amount: transferAmount});

        vm.prank(executor);
        vault.executeTransfers(transfers);

        assertEq(vault.balances(user1), amount1 - transferAmount);
        assertEq(vault.balances(user2), amount2 + transferAmount);
    }

    function test_ExecuteTransfersFailsIfNotExecutor() public {
        uint256 amount = 1000e6;
        token.mint(user1, amount);
        vm.prank(user1);
        token.approve(address(vault), amount);
        vm.prank(user1);
        vault.deposit(amount);

        Vault.Transfer[] memory transfers = new Vault.Transfer[](1);
        transfers[0] = Vault.Transfer({from: user1, to: user2, amount: 100e6});

        vm.prank(user1);
        vm.expectRevert("Vault: not authorized");
        vault.executeTransfers(transfers);
    }

    function test_ExecuteTransfersFailsIfInsufficientBalance() public {
        uint256 amount = 1000e6;
        token.mint(user1, amount);
        vm.prank(user1);
        token.approve(address(vault), amount);
        vm.prank(user1);
        vault.deposit(amount);

        Vault.Transfer[] memory transfers = new Vault.Transfer[](1);
        transfers[0] = Vault.Transfer({from: user1, to: user2, amount: amount + 1});

        vm.prank(executor);
        vm.expectRevert("Vault: insufficient balance");
        vault.executeTransfers(transfers);
    }

    function test_ExecuteTransfersBatch() public {
        // Setup: three users deposit
        token.mint(user1, 1000e6);
        token.mint(user2, 500e6);
        token.mint(user3, 300e6);

        vm.startPrank(user1);
        token.approve(address(vault), 1000e6);
        vault.deposit(1000e6);
        vm.stopPrank();

        vm.startPrank(user2);
        token.approve(address(vault), 500e6);
        vault.deposit(500e6);
        vm.stopPrank();

        vm.startPrank(user3);
        token.approve(address(vault), 300e6);
        vault.deposit(300e6);
        vm.stopPrank();

        // Execute batch transfers
        Vault.Transfer[] memory transfers = new Vault.Transfer[](3);
        transfers[0] = Vault.Transfer({from: user1, to: user2, amount: 200e6});
        transfers[1] = Vault.Transfer({from: user1, to: user3, amount: 100e6});
        transfers[2] = Vault.Transfer({from: user2, to: user3, amount: 50e6});

        vm.prank(executor);
        vault.executeTransfers(transfers);

        assertEq(vault.balances(user1), 700e6); // 1000 - 200 - 100
        assertEq(vault.balances(user2), 650e6); // 500 + 200 - 50
        assertEq(vault.balances(user3), 450e6); // 300 + 100 + 50
    }

    function test_SetExecutor() public {
        address newExecutor = address(0x5678);
        vault.setExecutor(newExecutor);
        assertEq(vault.executor(), newExecutor);
    }

    function test_SetExecutorFailsIfNotOwner() public {
        address newExecutor = address(0x5678);
        vm.prank(user1);
        vm.expectRevert();
        vault.setExecutor(newExecutor);
    }
}
