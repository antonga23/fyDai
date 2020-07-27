// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.10;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Market.sol";
import "../helpers/Delegable.sol";
import "../interfaces/IMarket.sol";



/// @dev LimitMarket is a proxy contract to Market that implements limit orders.
contract LimitMarket is Delegable {
    using SafeMath for uint256;

    IERC20 public dai;
    IERC20 public yDai;
    IMarket public market;

    constructor(address dai_, address yDai_, address market_) public Delegable() {
        dai = IERC20(dai_);
        yDai = IERC20(yDai_);
        market = IMarket(market_);
    }

    /// @dev Sell Dai for yDai
    /// @param from Wallet providing the dai being sold.
    /// Must have approved the operator with `market.addDelegate(limitMarket.address, { from: from })`.
    /// @param to Wallet receiving the yDai being bought
    /// @param daiIn Amount of dai being sold
    /// @param minYDaiOut Minimum amount of yDai being bought
    function sellDai(address from, address to, uint128 daiIn, uint128 minYDaiOut)
        external
        onlyHolderOrDelegate(from, "LimitMarket: Only Holder Or Delegate")
        returns(uint256)
    {
        uint256 yDaiOut = market.sellDai(from, to, daiIn);
        require(
            yDaiOut >= minYDaiOut,
            "LimitMarket: Limit not reached"
        );
        return yDaiOut;
    }

    /// @dev Buy Dai for yDai
    /// @param from Wallet providing the yDai being sold.
    /// Must have approved the operator with `market.addDelegate(limitMarket.address, { from: from })`.
    /// @param to Wallet receiving the dai being bought
    /// @param daiOut Amount of dai being bought
    /// @param maxYDaiIn Maximum amount of yDai being sold
    function buyDai(address from, address to, uint128 daiOut, uint128 maxYDaiIn)
        external
        onlyHolderOrDelegate(from, "LimitMarket: Only Holder Or Delegate")
        returns(uint256)
    {
        uint256 yDaiIn = market.buyDai(from, to, daiOut);
        require(
            maxYDaiIn >= yDaiIn,
            "LimitMarket: Limit exceeded"
        );
        return yDaiIn;
    }

    /// @dev Sell yDai for Dai
    /// @param from Wallet providing the yDai being sold.
    /// Must have approved the operator with `market.addDelegate(limitMarket.address, { from: from })`.
    /// @param to Wallet receiving the dai being bought
    /// @param yDaiIn Amount of yDai being sold
    /// @param minDaiOut Minimum amount of dai being bought
    function sellYDai(address from, address to, uint128 yDaiIn, uint128 minDaiOut)
        external
        onlyHolderOrDelegate(from, "LimitMarket: Only Holder Or Delegate")
        returns(uint256)
    {
        uint256 daiOut = market.sellYDai(from, to, yDaiIn);
        require(
            daiOut >= minDaiOut,
            "LimitMarket: Limit not reached"
        );
        return daiOut;
    }

    /// @dev Buy yDai for dai
    /// @param from Wallet providing the dai being sold.
    /// Must have approved the operator with `market.addDelegate(limitMarket.address, { from: from })`.
    /// @param to Wallet receiving the yDai being bought
    /// @param yDaiOut Amount of yDai being bought
    /// @param maxDaiIn Maximum amount of dai being sold
    function buyYDai(address from, address to, uint128 yDaiOut, uint128 maxDaiIn)
        external
        onlyHolderOrDelegate(from, "LimitMarket: Only Holder Or Delegate")
        returns(uint256)
    {
        uint256 daiIn = market.buyYDai(from, to, yDaiOut);
        require(
            maxDaiIn >= daiIn,
            "LimitMarket: Limit exceeded"
        );
        return daiIn;
    }
}