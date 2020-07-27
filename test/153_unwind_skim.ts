import { CHAI, WETH, chi1, rate1, daiTokens1, wethTokens1, chaiTokens1, toRay, mulRay, divRay } from './shared/utils';
import { YieldEnvironment, Contract } from "./shared/fixtures";
// @ts-ignore
import helper from 'ganache-time-traveler';
// @ts-ignore
import { expectRevert } from '@openzeppelin/test-helpers';

contract('Unwind - Skim', async (accounts) =>  {
    let [ owner, user1, user2 ] = accounts;

    let snapshot: any;
    let snapshotId: string;

    let env: YieldEnvironment;

    let dai: Contract;
    let vat: Contract;
    let controller: Contract;
    let treasury: Contract;
    let weth: Contract;
    let liquidations: Contract;
    let unwind: Contract;
    let end: Contract;
    let chai: Contract;
    let yDai1: Contract;
    let yDai2: Contract;

    let maturity1: number;
    let maturity2: number;

    const THREE_MONTHS = 7776000;

    beforeEach(async() => {
        snapshot = await helper.takeSnapshot();
        snapshotId = snapshot['result'];

        env = await YieldEnvironment.setup(user1)
        controller = env.controller;
        treasury = env.treasury;
        unwind = env.unwind;

        vat = env.maker.vat;
        weth = env.maker.weth;
        end = env.maker.end;
        chai = env.maker.chai;

        // Setup yDai
        const block = await web3.eth.getBlockNumber();
        maturity1 = (await web3.eth.getBlock(block)).timestamp + 1000;
        maturity2 = (await web3.eth.getBlock(block)).timestamp + 2000;
        yDai1 = await env.newYDai(maturity1, "Name", "Symbol");
        yDai2 = await env.newYDai(maturity2, "Name", "Symbol");
        await yDai1.orchestrate(unwind.address)
        await yDai2.orchestrate(unwind.address)
        await treasury.orchestrate(owner)
        await end.rely(owner, { from: owner });       // `owner` replaces MKR governance
    });

    afterEach(async() => {
        await helper.revertToSnapshot(snapshotId);
    });

    it("does not allow to skim before startSkim", async() => {
        await expectRevert(
            unwind.skimWhileLive({ from: owner }),
            "Unwind: Only after skimStart",
        );
    });

    describe("three months after the expiration of the last maturity", () => {
        beforeEach(async() => {
            await helper.advanceTime(THREE_MONTHS + 2000);
            await helper.advanceBlock();
        });

        describe("with chai savings", () => {
            beforeEach(async() => {
                await env.maker.getChai(owner, chaiTokens1.mul(10), chi1, rate1);
                await chai.transfer(treasury.address, chaiTokens1.mul(10), { from: owner });
                // profit = 10 chai
            });

            it("chai savings are added to profits", async() => {
                await unwind.skimWhileLive({ from: owner });

                assert.equal(
                    await chai.balanceOf(user1),
                    chaiTokens1.mul(10).toString(),
                    'User1 should have ' + chaiTokens1.mul(10).toString() + ' chai wei',
                );
            });

            it("chai held as collateral doesn't count as profits", async() => {
                await env.maker.getChai(user2, chaiTokens1, chi1, rate1);
                await chai.approve(treasury.address, chaiTokens1, { from: user2 });
                await controller.post(CHAI, user2, user2, chaiTokens1, { from: user2 });

                await unwind.skimWhileLive({ from: owner });

                assert.equal(
                    await chai.balanceOf(user1),
                    chaiTokens1.mul(10).toString(),
                    'User1 should have ' + chaiTokens1.mul(10).toString() + ' chai wei',
                );
                // profit = 10 chai
            });

            it("unredeemed yDai and controller weth debt cancel each other", async() => {
                await env.postWeth(user2, wethTokens1);
                await controller.borrow(WETH, await yDai1.maturity(), user2, user2, daiTokens1, { from: user2 }); // controller debt assets == yDai liabilities 

                await unwind.skimWhileLive({ from: owner });

                assert.equal(
                    await chai.balanceOf(user1),
                    chaiTokens1.mul(10).toString(),
                    'User1 should have ' + chaiTokens1.mul(10).toString() + ' chai wei',
                );
                // profit = 10 chai
            });

            it("unredeemed yDai and controller chai debt cancel each other", async() => {
                await env.postChai(user2, chaiTokens1, chi1, rate1);
                await controller.borrow(CHAI, await yDai1.maturity(), user2, user2, daiTokens1, { from: user2 }); // controller debt assets == yDai liabilities 

                await unwind.skimWhileLive({ from: owner });

                assert.equal(
                    await chai.balanceOf(user1),
                    chaiTokens1.mul(10).toString(),
                    'User1 should have ' + chaiTokens1.mul(10).toString() + ' chai wei',
                );
                // profit = 10 chai
            });

            describe("with dai debt", () => {
                beforeEach(async() => {
                    await treasury.pullDai(owner, daiTokens1, { from: owner });
                    // profit = 9 chai
                });
        
                it("dai debt is deduced from profits", async() => {
                    await unwind.skimWhileLive({ from: owner });
        
                    assert.equal(
                        await chai.balanceOf(user1),
                        chaiTokens1.mul(9).toString(),
                        'User1 should have ' + chaiTokens1.mul(9).toString() + ' chai wei',
                    );
                });
            });

            describe("after maturity, with a rate increase", () => {
                const rateIncrease = toRay(0.25);
                const rate2 = rate1.add(rateIncrease);

                const rateDifferential = divRay(rate2, rate1);

                beforeEach(async() => {
                    await env.postWeth(user2, wethTokens1);
                    await controller.borrow(WETH, await yDai1.maturity(), user2, user2, daiTokens1, { from: user2 }); // controller debt assets == yDai liabilities 

                    await env.postChai(user2, chaiTokens1, chi1, rate1);
                    await controller.borrow(CHAI, await yDai1.maturity(), user2, user2, daiTokens1, { from: user2 }); // controller debt assets == yDai liabilities 
                    // profit = 10 chai

                    // yDai matures
                    // await helper.advanceTime(1000);
                    // await helper.advanceBlock();
                    await yDai1.mature();

                    await vat.fold(WETH, vat.address, rateIncrease, { from: owner });
                    // profit = 10 chai + 1 chai * (rate2/rate0 - 1)
                });

                it("there is an extra profit only from weth debt", async() => {
                    await unwind.skimWhileLive({ from: owner });

                    const expectedProfit = chaiTokens1.mul(10).add(mulRay(chaiTokens1, rateDifferential.sub(toRay(1))));
        
                    assert.equal(
                        await chai.balanceOf(user1),
                        expectedProfit.toString(),
                        'User1 should have ' + expectedProfit.toString() + ' chai wei, instead has ' + (await chai.balanceOf(user1)),
                    );
                });
            });

            describe("after maturity, with a rate increase", () => {
                const rateIncrease = toRay(0.25);
                const rate2 = rate1.add(rateIncrease);
                const rate3 = rate2.add(rateIncrease);

                const rateDifferential1 = divRay(rate3, rate1);
                const rateDifferential2 = divRay(rate3, rate2);

                beforeEach(async() => {
                    await env.postWeth(user2, wethTokens1);
                    await controller.borrow(WETH, await yDai1.maturity(), user2, user2, daiTokens1, { from: user2 }); // controller debt assets == yDai liabilities 

                    await env.postWeth(user2, wethTokens1);
                    await controller.borrow(WETH, await yDai2.maturity(), user2, user2, daiTokens1, { from: user2 }); // controller debt assets == yDai liabilities 

                    await env.postChai(user2, chaiTokens1, chi1, rate1);
                    await controller.borrow(CHAI, await yDai1.maturity(), user2, user2, daiTokens1, { from: user2 }); // controller debt assets == yDai liabilities 
                    // profit = 10 chai

                    // yDai1 matures
                    // await helper.advanceTime(1000);
                    // await helper.advanceBlock();
                    await yDai1.mature();

                    await vat.fold(WETH, vat.address, rateIncrease, { from: owner });

                    // profit = 10 chai + 1 chai * (rate3/rate1 - 1)

                    // yDai2 matures
                    // await helper.advanceTime(2000);
                    // await helper.advanceBlock();
                    await yDai2.mature();

                    await vat.fold(WETH, vat.address, rateIncrease, { from: owner });
                    // profit = 10 chai + 1 chai * (rate2/rate1 - 1) + 1 chai * (rate3/rate2 - 1)
                });

                it("profit is acummulated from several series", async() => {
                    await unwind.skimWhileLive({ from: owner });

                    const expectedProfit = chaiTokens1.mul(10)
                        .add(mulRay(chaiTokens1, rateDifferential1.sub(toRay(1)))) // yDai1
                        .add(mulRay(chaiTokens1, rateDifferential2.sub(toRay(1)))) // yDai2
                        .sub(1); // Rounding somewhere
        
                    assert.equal(
                        await chai.balanceOf(user1),
                        expectedProfit.toString(),
                        'User1 should have ' + expectedProfit.toString() + ' chai wei, instead has ' + (await chai.balanceOf(user1)),
                    );
                });
            });
        });
    });
});