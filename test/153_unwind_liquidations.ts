import { id } from 'ethers/lib/utils'
// @ts-ignore
import helper from 'ganache-time-traveler'
// @ts-ignore
import { BN } from '@openzeppelin/test-helpers'
import {
  WETH,
  spot,
  rate1,
  chi1,
  chaiTokens1,
  wethTokens1,
  toRay,
  subBN,
  mulRay,
  divRay,
  bnify,
  ZERO,
} from './shared/utils'
import { YieldEnvironment, Contract } from './shared/fixtures'

contract('Unwind - Liquidations', async (accounts) => {
  let [owner, user1, user2, user3] = accounts

  let snapshot: any
  let snapshotId: string

  let env: YieldEnvironment

  let vat: Contract
  let fyDai1: Contract
  let controller: Contract
  let treasury: Contract
  let weth: Contract
  let liquidations: Contract
  let unwind: Contract
  let end: Contract

  let maturity1: number
  let maturity2: number

  const rate2 = toRay(1.3) // At the time of writing, rate is 1.02004188

  const fix = divRay(toRay(1.0), mulRay(spot, toRay(1.1)))

  beforeEach(async () => {
    snapshot = await helper.takeSnapshot()
    snapshotId = snapshot['result']

    const block = await web3.eth.getBlockNumber()
    maturity1 = (await web3.eth.getBlock(block)).timestamp + 1000
    maturity2 = (await web3.eth.getBlock(block)).timestamp + 2000

    env = await YieldEnvironment.setup([maturity1, maturity2])
    controller = env.controller
    treasury = env.treasury
    unwind = env.unwind
    liquidations = env.liquidations

    vat = env.maker.vat
    weth = env.maker.weth
    end = env.maker.end

    // Setup fyDai
    fyDai1 = env.fyDais[0]
    await end.rely(owner, { from: owner }) // `owner` replaces MKR governance
  })

  afterEach(async () => {
    await helper.revertToSnapshot(snapshotId)
  })

  describe('with posted collateral and borrowed fyDai', () => {
    beforeEach(async () => {
      // Weth setup
      await env.postWeth(user2, wethTokens1)
      let toBorrow = await env.unlockedOf(WETH, user2)
      await controller.borrow(WETH, maturity1, user2, user2, toBorrow, { from: user2 })

      await env.postWeth(user3, bnify(wethTokens1).mul(2))
      toBorrow = bnify(await env.unlockedOf(WETH, user3))
        .div(2)
        .toString()
      await controller.borrow(WETH, maturity1, user3, user3, toBorrow, { from: user3 })
      await controller.borrow(WETH, maturity2, user3, user3, toBorrow, { from: user3 })

      await env.postChai(user1, chaiTokens1, chi1, rate1)

      // Make sure that end.sol will have enough weth to cash chai savings
      await env.maker.getDai(owner, bnify(wethTokens1).mul(10), rate1)

      // Make fyDai1 borrowers go under by raising the rate, then liquidate them
      await helper.advanceTime(1000)
      await helper.advanceBlock()
      await fyDai1.mature()
      await vat.fold(WETH, vat.address, subBN(rate2, rate1), { from: owner })
      await liquidations.liquidate(user2, { from: user1 })
      await liquidations.liquidate(user3, { from: user1 })
    })

    it('allows orchestrated contracts to erase liquidations vaults', async () => {
      // Allow `owner` to bypass orchestration restrictions
      await liquidations.orchestrate(owner, id('erase(address)'), { from: owner })
      const userVault = await liquidations.vaults(user2, { from: owner })
      const totals = await liquidations.totals({ from: owner })
      const totalRemainingDebt = subBN(totals.debt.toString(), userVault.debt.toString())
      const totalRemainingCollateral = subBN(totals.collateral.toString(), userVault.collateral.toString())

      await liquidations.erase(user2, { from: owner })
      expect(new BN(userVault.debt)).to.be.bignumber.gt(new BN(0))
      expect(new BN(userVault.collateral)).to.be.bignumber.gt(new BN(0))
      expect(new BN(totals.debt)).to.be.bignumber.gt(new BN(0))
      expect(new BN(totals.collateral)).to.be.bignumber.gt(new BN(0))
      assert.equal((await liquidations.vaults(user2, { from: owner })).debt, 0, 'User debt should have been erased')
      assert.equal(
        (await liquidations.vaults(user2, { from: owner })).debt,
        0,
        'User collateral should have been erased'
      )
      assert.equal(
        (await liquidations.totals({ from: owner })).debt,
        totalRemainingDebt.toString(),
        'Total debt should have been ' +
          totalRemainingDebt +
          ', instead is ' +
          (await liquidations.totals({ from: owner })).debt
      )
      assert.equal(
        (await liquidations.totals({ from: owner })).collateral,
        totalRemainingCollateral.toString(),
        'Total collateral should have been ' +
          totalRemainingCollateral +
          ', instead is ' +
          (await liquidations.totals({ from: owner })).collateral
      )
    })

    describe('once shutdown', () => {
      beforeEach(async () => {
        await env.shutdown(owner, user1, user2)
      })

      it('allows users to settle liquidations vaults', async () => {
        const userBalance = await weth.balanceOf(user2, { from: user2 })
        const userVault = await liquidations.vaults(user2, { from: owner })
        const settlingCost = mulRay(userVault.debt.toString(), fix)
        const wethRemainder = bnify(userVault.collateral.toString()).sub(settlingCost)

        assert.equal(userBalance, 0, 'User2 should have no weth')

        await unwind.settleLiquidations(user2, { from: owner })

        if (wethRemainder.lt(ZERO)) {
          assert.equal(
            await weth.balanceOf(user2, { from: user2 }),
            0,
            'User2 should have no weth, instead has ' + (await weth.balanceOf(user2, { from: user2 }))
          )
        } else {
          assert.equal(
            await weth.balanceOf(user2, { from: user2 }),
            wethRemainder.toString(),
            'User2 should have ' +
              wethRemainder +
              ' weth, instead has ' +
              (await weth.balanceOf(user2, { from: user2 }))
          )
        }
      })
    })
  })
})
