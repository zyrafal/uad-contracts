// SPDX-License-Identifier: MIT
pragma solidity ^0.8.3;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IUbiquityAlgorithmicDollar.sol";
import "./interfaces/ICurveFactory.sol";
import "./interfaces/IMetaPool.sol";

import "./TWAPOracle.sol";
import "hardhat/console.sol";

/// @title A central config for the uAD system. Also acts as a central
/// access control manager.
/// @notice For storing constants. For storing variables and allowing them to
/// be changed by the admin (governance)
/// @dev This should be used as a central access control manager which other
/// contracts use to check permissions
contract UbiquityAlgorithmicDollarManager is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant UBQ_MINTER_ROLE = keccak256("UBQ_MINTER_ROLE");
    bytes32 public constant UBQ_BURNER_ROLE = keccak256("UBQ_BURNER_ROLE");

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant COUPON_MANAGER_ROLE = keccak256("COUPON_MANAGER");
    bytes32 public constant BONDING_MANAGER_ROLE = keccak256("BONDING_MANAGER");
    bytes32 public constant INCENTIVE_MANAGER_ROLE =
        keccak256("INCENTIVE_MANAGER");
    bytes32 public constant UBQ_TOKEN_MANAGER_ROLE =
        keccak256("UBQ_TOKEN_MANAGER_ROLE");
    address public twapOracleAddress;
    address public debtCouponAddress;
    address public uADTokenAddress;
    address public comparisonTokenAddress; // 3Crv
    address public couponCalculatorAddress;
    address public dollarCalculatorAddress;
    address public bondingShareAddress;
    address public stableSwapMetaPoolAddress;
    address public autoRedeemPoolTokenAddress;
    address public curveIncentiveAddress;
    address public treasuryAddress;
    address public uGovFundAddress;
    address public lpRewardsAddress;
    address public uGOVTokenAddress;

    //key = address of couponmanager, value = excessdollardistributor
    mapping(address => address) private _excessDollarDistributors;

    modifier onlyAdmin() {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "uADMGR: Caller is not admin"
        );
        _;
    }

    constructor(address _admin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
        _setupRole(UBQ_MINTER_ROLE, _admin);
        _setupRole(PAUSER_ROLE, _admin);
        _setupRole(COUPON_MANAGER_ROLE, _admin);
        _setupRole(BONDING_MANAGER_ROLE, _admin);
        _setupRole(INCENTIVE_MANAGER_ROLE, _admin);
        _setupRole(UBQ_TOKEN_MANAGER_ROLE, address(this));
    }

    // TODO Add a generic setter for extra addresses that needs to be linked

    function setTwapOracleAddress(address _twapOracleAddress)
        external
        onlyAdmin
    {
        twapOracleAddress = _twapOracleAddress;
        // to be removed

        TWAPOracle oracle = TWAPOracle(twapOracleAddress);
        oracle.update();

        uint256 p = oracle.consult(uADTokenAddress);
        console.log("## setTwapOracleAddress price:%s", p);
    }

    function setDebtCouponAddress(address _debtCouponAddress)
        external
        onlyAdmin
    {
        debtCouponAddress = _debtCouponAddress;
    }

    function setIncentiveToUAD(address _account, address _incentiveAddress)
        external
        onlyAdmin
    {
        IUbiquityAlgorithmicDollar(uADTokenAddress).setIncentiveContract(
            _account,
            _incentiveAddress
        );
    }

    function setuADTokenAddress(address _uADTokenAddress) external onlyAdmin {
        uADTokenAddress = _uADTokenAddress;
    }

    function setuGOVTokenAddress(address _uGOVTokenAddress) external onlyAdmin {
        uGOVTokenAddress = _uGOVTokenAddress;
    }

    function setComparisonTokenAddress(address _comparisonTokenAddress)
        external
        onlyAdmin
    {
        comparisonTokenAddress = _comparisonTokenAddress;
    }

    function setCouponCalculatorAddress(address _couponCalculatorAddress)
        external
        onlyAdmin
    {
        couponCalculatorAddress = _couponCalculatorAddress;
    }

    function setDollarCalculatorAddress(address _dollarCalculatorAddress)
        external
        onlyAdmin
    {
        dollarCalculatorAddress = _dollarCalculatorAddress;
    }

    function setExcessDollarsDistributor(
        address debtCouponManagerAddress,
        address excessCouponDistributor
    ) external onlyAdmin {
        _excessDollarDistributors[
            debtCouponManagerAddress
        ] = excessCouponDistributor;
    }

    /**
    @notice deploy a new Curve metapools for uAD Token uAD/3Pool
    @dev  From the curve documentation for uncollateralized algorithmic
    stablecoins amplification should be 5-10
    @param _curveFactory MetaPool factory address
    @param _crvBasePool Address of the base pool to use within the new metapool.
    @param _crv3PoolTokenAddress curve 3Pool token Address
    @param _amplificationCoefficient amplification coefficient. The smaller
     it is the closer to a constant product we are.
    @param _fee Trade fee, given as an integer with 1e10 precision.
    */
    function deployStableSwapPool(
        address _curveFactory,
        address _crvBasePool,
        address _crv3PoolTokenAddress,
        uint256 _amplificationCoefficient,
        uint256 _fee
    ) external onlyAdmin {
        // Create new StableSwap meta pool (uAD <-> 3Crv)
        address metaPool =
            ICurveFactory(_curveFactory).deploy_metapool(
                _crvBasePool,
                ERC20(uADTokenAddress).name(),
                ERC20(uADTokenAddress).symbol(),
                uADTokenAddress,
                _amplificationCoefficient,
                _fee
            );
        stableSwapMetaPoolAddress = metaPool;

        // Approve the newly-deployed meta pool to transfer this contract's funds
        uint256 crv3PoolTokenAmount =
            IERC20(_crv3PoolTokenAddress).balanceOf(address(this));
        uint256 uADTokenAmount =
            IERC20(uADTokenAddress).balanceOf(address(this));

        // safe approve revert if approve from non-zero to non-zero allowance
        IERC20(_crv3PoolTokenAddress).safeApprove(metaPool, 0);
        IERC20(_crv3PoolTokenAddress).safeApprove(
            metaPool,
            crv3PoolTokenAmount
        );

        IERC20(uADTokenAddress).safeApprove(metaPool, 0);
        IERC20(uADTokenAddress).safeApprove(metaPool, uADTokenAmount);

        // coin at index 0 is uAD and index 1 is 3CRV
        require(
            IMetaPool(metaPool).coins(0) == uADTokenAddress &&
                IMetaPool(metaPool).coins(1) == _crv3PoolTokenAddress,
            "uADMGR: COIN_ORDER_MISMATCH"
        );
        // Add the initial liquidity to the StableSwap meta pool
        uint256[2] memory amounts =
            [
                IERC20(uADTokenAddress).balanceOf(address(this)),
                IERC20(_crv3PoolTokenAddress).balanceOf(address(this))
            ];

        IMetaPool(metaPool).add_liquidity(amounts, 0, msg.sender);
    }

    function setBondingShareAddress(address _bondingShareAddress)
        external
        onlyAdmin
    {
        bondingShareAddress = _bondingShareAddress;
    }

    function setStableSwapMetaPoolAddress(address _stableSwapMetaPoolAddress)
        external
        onlyAdmin
    {
        stableSwapMetaPoolAddress = _stableSwapMetaPoolAddress;
    }

    function setAutoRedeemPoolTokenAddress(address _autoRedeemPoolTokenAddress)
        external
        onlyAdmin
    {
        autoRedeemPoolTokenAddress = _autoRedeemPoolTokenAddress;
    }

    /**
     @notice set the lpRewards smart contract address
    @dev rewards for bonding contract participants
         that provided liquidity to uGOV pool for a certain duration
    @param _lpRewardsAddress lpReward address
     */
    function setLpRewardsAddress(address _lpRewardsAddress) external onlyAdmin {
        lpRewardsAddress = _lpRewardsAddress;
    }

    /**
     @notice set the uGOV fund address
    @dev All funds deposited in the uGOV fund will be used
         to buyback & LP on our uAD-uGOV primary market
    @param _uGovFundAddress uGOV fund address
     */
    function setuGovFundAddress(address _uGovFundAddress) external onlyAdmin {
        uGovFundAddress = _uGovFundAddress;
    }

    /**
     @notice set the treasury address
    @dev the treasury fund is used to maintain the protocol
    @param _treasuryAddress treasury fund address
     */
    function setTreasuryAddress(address _treasuryAddress) external onlyAdmin {
        treasuryAddress = _treasuryAddress;
    }

    function getExcessDollarsDistributor(address _debtCouponManagerAddress)
        external
        view
        returns (address)
    {
        return _excessDollarDistributors[_debtCouponManagerAddress];
    }
}
