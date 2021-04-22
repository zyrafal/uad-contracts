import { expect } from "chai";
import { ContractTransaction, Signer, BigNumber } from "ethers";
import { deployments, ethers, getNamedAccounts, network } from "hardhat";
import { BondingShare } from "../artifacts/types/BondingShare";
import { UbiquityAlgorithmicDollarManager } from "../artifacts/types/UbiquityAlgorithmicDollarManager";
import { UbiquityAlgorithmicDollar } from "../artifacts/types/UbiquityAlgorithmicDollar";
import { ERC20 } from "../artifacts/types/ERC20";
import { IMetaPool } from "../artifacts/types/IMetaPool";
import { ICurveFactory } from "../artifacts/types/ICurveFactory";
import { Bonding } from "../artifacts/types/Bonding";
import { TWAPOracle } from "../artifacts/types/TWAPOracle";

function log(bigN: BigNumber): string {
  return ethers.utils.formatEther(bigN);
}

describe("UseCase1", () => {
  const id = 42;
  const UBQ_MINTER_ROLE = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("UBQ_MINTER_ROLE")
  );

  let twapOracle: TWAPOracle;
  let metaPool: IMetaPool;
  let admin: Signer;
  let bonding: Bonding;
  let bondingShare: BondingShare;
  let manager: UbiquityAlgorithmicDollarManager;
  let uAD: UbiquityAlgorithmicDollar;
  let sablier: string;
  let curvePoolFactory: ICurveFactory;
  let curveFactory: string;
  let curve3CrvBasePool: string;
  let curve3CrvToken: string;
  let curveWhaleAddress: string;
  let metaPoolAddr: string;
  let adminAddress: string;

  before(async () => {
    // GET contracts adresses
    ({
      sablier,
      curveFactory,
      curve3CrvBasePool,
      curve3CrvToken,
      curveWhaleAddress,
    } = await getNamedAccounts());

    // GET first EOA account as admin Signer
    [admin] = await ethers.getSigners();
    adminAddress = await admin.getAddress();

    // DEPLOY UbiquityAlgorithmicDollarManager Contract
    manager = (await (
      await ethers.getContractFactory("UbiquityAlgorithmicDollarManager")
    ).deploy(adminAddress)) as UbiquityAlgorithmicDollarManager;

    // DEPLOY Bonding Contract
    bonding = (await (await ethers.getContractFactory("Bonding")).deploy(
      manager.address,
      sablier
    )) as Bonding;
    await manager.setLpRewardsAddress(bonding.address);

    // DEPLOY BondingShare Contract
    bondingShare = (await (
      await ethers.getContractFactory("BondingShare")
    ).deploy(manager.address)) as BondingShare;
    await manager.setBondingShareAddress(bondingShare.address);

    // DEPLOY UAD token Contract
    uAD = (await (
      await ethers.getContractFactory("UbiquityAlgorithmicDollar")
    ).deploy(manager.address)) as UbiquityAlgorithmicDollar;
    await manager.setuADTokenAddress(uAD.address);

    // GET 3CRV token contract
    const crvToken: ERC20 = (await ethers.getContractAt(
      "ERC20",
      curve3CrvToken
    )) as ERC20;

    // GET curve factory contract
    curvePoolFactory = (await ethers.getContractAt(
      "ICurveFactory",
      curveFactory
    )) as ICurveFactory;

    // Mint 10000 uAD each for admin and manager
    const mintings = [adminAddress, manager.address].map(
      async (signer: string): Promise<ContractTransaction> =>
        uAD.mint(signer, ethers.utils.parseEther("10000"))
    );
    await Promise.all(mintings);

    // Impersonate curve whale account
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [curveWhaleAddress],
    });
    const curveWhale = ethers.provider.getSigner(curveWhaleAddress);

    // Mint uAD for whale
    await uAD.mint(curveWhaleAddress, ethers.utils.parseEther("10"));
    await crvToken
      .connect(curveWhale)
      .transfer(manager.address, ethers.utils.parseEther("10000"));
    await manager.deployStableSwapPool(
      curveFactory,
      curve3CrvBasePool,
      crvToken.address,
      10,
      4000000
    );
    metaPoolAddr = await manager.stableSwapMetaPoolAddress();

    // GET curve meta pool contract
    metaPool = (await ethers.getContractAt(
      "IMetaPool",
      metaPoolAddr
    )) as IMetaPool;

    // DEPLOY TWAPOracle Contract
    twapOracle = (await (await ethers.getContractFactory("TWAPOracle")).deploy(
      metaPoolAddr,
      uAD.address,
      curve3CrvToken
    )) as TWAPOracle;
    await manager.setTwapOracleAddress(twapOracle.address);
  });

  describe("UseCase bond 100 LP tokens for 6 weeks and withdraw", () => {
    it("deposit 100 LPs tokens should give 101.46 bond tokens", async () => {
      await bonding.setRedeemStreamTime(ethers.BigNumber.from("0"));

      const addr: string = await admin.getAddress();
      const amount: BigNumber = BigNumber.from(10).pow(18).mul(100);

      // oldBalLp = balanceOf lpTokens
      const oldBalLp: BigNumber = await metaPool.balanceOf(bonding.address);

      // oldBalBond = balanceOf bondTokens
      const oldBalBond: BigNumber = await bondingShare.balanceOf(addr, id);
      expect(oldBalBond).to.be.eq(0);

      // bond 10 Lp tokens for 6 weeks
      await metaPool.approve(bonding.address, amount);
      await bonding.connect(admin).bondTokens(amount, 6);

      //  newBalLp = balanceOf lpTokens
      const newBalLp: BigNumber = await metaPool.balanceOf(bonding.address);

      console.log("deltaLP  ", log(newBalLp.sub(oldBalLp)));
      expect(newBalLp).to.be.equal(oldBalLp.add(amount));

      //  newBalBond = balanceOf bondTokens
      const newBalBond: BigNumber = await bondingShare.balanceOf(addr, id);

      const deltaBond = newBalBond.sub(oldBalBond);
      console.log("deltaBond", log(deltaBond));

      const epsilon = deltaBond.sub(
        BigNumber.from(10).pow(9).mul(101469693845)
      );
      expect(epsilon.div(BigNumber.from(10).pow(8)).abs()).to.be.lte(10);

      await bondingShare.setApprovalForAll(bonding.address, true);
      await bonding.redeemShares(newBalBond);

      //  finalBalBond = balanceOf bondTokens
      const finalBalBond: BigNumber = await bondingShare.balanceOf(addr, id);

      console.log("finalBond", log(finalBalBond));
      expect(finalBalBond).to.be.equal(0);
    });
  });
});
