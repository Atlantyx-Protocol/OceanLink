// ---------------------------------------------------------------------------
// Shared contract ABI definitions
//
// Single source of truth for ERC20 and HTLC ABIs used across the backend.
// ---------------------------------------------------------------------------

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
] as const;

export const HTLC_ABI = [
  // Write functions
  'function newOrder((address token, uint256 totalAmount, uint256 timelock, address[] receivers, uint256[] amounts, bytes32[] hashlocks, address onBehalfOf) params) external returns (uint256 orderId)',
  'function withdraw(uint256 orderId, uint256 fillId, bytes32 preimage) external',
  'function refund(uint256 orderId) external',
  // Read functions
  'function getOrder(uint256 orderId) external view returns (tuple(address sender, address token, uint256 totalAmount, uint256 remainingAmount, uint256 timelock, uint8 status, uint256 fillCount))',
  'function getFill(uint256 orderId, uint256 fillId) external view returns (tuple(address receiver, uint256 amount, bytes32 hashlock, bool claimed))',
  'function getOrderFills(uint256 orderId) external view returns (tuple(address receiver, uint256 amount, bytes32 hashlock, bool claimed)[])',
  'function nextOrderId() external view returns (uint256)',
  'function orderExistsCheck(uint256 orderId) external view returns (bool)',
  'function getClaimStatus(uint256 orderId) external view returns (uint256 claimed, uint256 total)',
  'function allowWithdrawAfterExpiry() external view returns (bool)',
  // Events
  'event OrderCreated(uint256 indexed orderId, address indexed sender, address indexed token, uint256 totalAmount, uint256 timelock, uint256 fillCount)',
  'event FillCreated(uint256 indexed orderId, uint256 indexed fillId, address indexed receiver, uint256 amount, bytes32 hashlock)',
  'event FillWithdrawn(uint256 indexed orderId, uint256 indexed fillId, address indexed receiver, bytes32 preimage)',
  'event OrderRefunded(uint256 indexed orderId, uint256 refundedAmount)',
] as const;
