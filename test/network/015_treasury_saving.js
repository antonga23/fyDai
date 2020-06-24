const Vat = artifacts.require("Vat");
const Weth = artifacts.require("WETH9");
const ERC20 = artifacts.require("TestERC20");
const GemJoin = artifacts.require("GemJoin");
const DaiJoin = artifacts.require("DaiJoin");
const Jug = artifacts.require("Jug");
const Pot = artifacts.require("Pot");
const Chai = artifacts.require("Chai");
const GasToken = artifacts.require("GasToken1");
const WethOracle = artifacts.require("WethOracle");
const ChaiOracle = artifacts.require("ChaiOracle");
const Treasury = artifacts.require("Treasury");
const Dealer = artifacts.require("Dealer");

const truffleAssert = require('truffle-assertions');
const helper = require('ganache-time-traveler');
const { expectRevert } = require('@openzeppelin/test-helpers');
const { toWad, toRay, toRad, addBN, subBN, mulRay, divRay } = require('../shared/utils');

contract('Treasury - Lending', async (accounts) =>  {
    let [ owner, user ] = accounts;

    let vat;
    let weth;
    let wethJoin;
    let dai;
    let daiJoin;
    let jug;
    let pot;
    let chai;
    let gasToken;
    let wethOracle;
    let chaiOracle;
    let treasury;
    let dealer;

    let ilk = web3.utils.fromAscii('ETH-A');
    let spot;
    let rate;
    const chi = toRay(1.2); // TODO: Set it up in migrations
    
    let wethTokens;
    let daiTokens;
    let daiDebt;
    let chaiTokens;

    beforeEach(async() => {
        vat = await Vat.deployed();
        weth = await Weth.deployed();
        wethJoin = await GemJoin.deployed();
        dai = await ERC20.deployed();
        daiJoin = await DaiJoin.deployed();
        jug = await Jug.deployed();
        pot = await Pot.deployed();
        chai = await Chai.deployed();
        gasToken = await GasToken.deployed();

        spot  = (await vat.ilks(ilk)).spot;
        rate  = (await vat.ilks(ilk)).rate;
        wethTokens = toWad(1);
        daiTokens = mulRay(wethTokens.toString(), spot.toString());
        daiDebt = divRay(daiTokens.toString(), rate.toString());

        await pot.setChi(chi); // TODO: Set it up in migrations
        chaiTokens = divRay(daiTokens, chi);

        // Setup chaiOracle
        chaiOracle = await ChaiOracle.deployed();

        // Set chi
        await pot.setChi(chi, { from: owner });
        
        treasury = await Treasury.deployed();
        await treasury.grantAccess(owner, { from: owner });
        await vat.hope(daiJoin.address, { from: owner });
    });

    it("allows to save dai", async() => {
        // Borrow some dai
        await weth.deposit({ from: owner, value: wethTokens});
        await weth.approve(wethJoin.address, wethTokens, { from: owner }); 
        await wethJoin.join(owner, wethTokens, { from: owner });
        await vat.frob(ilk, owner, owner, owner, wethTokens, daiDebt, { from: owner });
        await daiJoin.exit(owner, daiTokens, { from: owner });
        
        await dai.transfer(treasury.address, daiTokens, { from: owner }); 
        await treasury.pushDai({ from: owner });

        // Test transfer of collateral
        assert.equal(
            await chai.balanceOf(treasury.address),
            chaiTokens.toString(),
            "Treasury should have chai"
        );
        assert.equal(
            await treasury.savings.call(),
            daiTokens.toString(),
            "Treasury should have " + daiTokens + " savings in dai units, instead has " + await treasury.savings.call(),
        );
        assert.equal(
            await dai.balanceOf(owner),
            0,
            "User should not have dai",
        );
    });

    it("pulls dai from savings", async() => {
        await treasury.pullDai(owner, daiTokens, { from: owner });

        assert.equal(
            await chai.balanceOf(treasury.address),
            0,
            "Treasury should not have chai",
        );
        assert.equal(
            await treasury.savings.call(),
            0,
            "Treasury should not have savings in dai units"
        );
        assert.equal(
            await dai.balanceOf(owner),
            daiTokens.toString(),
            "User should have dai",
        );
    });

    it("allows to save chai", async() => {
        await dai.approve(chai.address, daiTokens, { from: owner });
        await chai.join(owner, daiTokens, { from: owner });
        await chai.transfer(treasury.address, chaiTokens, { from: owner }); 
        await treasury.pushChai({ from: owner });

        // Test transfer of collateral
        assert.equal(
            await chai.balanceOf(treasury.address),
            chaiTokens.toString(),
            "Treasury should have chai"
        );
        assert.equal(
            await treasury.savings.call(),
            daiTokens.toString(),
            "Treasury should report savings in dai units"
        );
        assert.equal(
            await chai.balanceOf(owner),
            0,
            "User should not have chai",
        );
    });

    it("pulls chai from savings", async() => {
        await treasury.pullChai(owner, chaiTokens, { from: owner });

        assert.equal(
            await chai.balanceOf(treasury.address),
            0,
            "Treasury should not have chai",
        );
        assert.equal(
            await treasury.savings.call(),
            0,
            "Treasury should not have savings in dai units"
        );
        assert.equal(
            await chai.balanceOf(owner),
            chaiTokens.toString(),
            "User should have chai",
        );

        // Exchange the chai back
        await chai.exit(owner, chaiTokens, { from: owner });

        // Repay the dai
        await dai.approve(daiJoin.address, daiTokens, { from: owner }); 
        await daiJoin.join(owner, daiTokens, { from: owner });
        await vat.frob(ilk, owner, owner, owner, wethTokens.mul(-1), daiDebt.mul(-1), { from: owner });
        await wethJoin.exit(owner, wethTokens, { from: owner });

        // Withdraw the eth
        await weth.withdraw(wethTokens, { from: owner });
    });
});