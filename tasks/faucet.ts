import { task } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import { ERC20 } from "../artifacts/types/ERC20";
import { UbiquityAlgorithmicDollarManager } from "../artifacts/types/UbiquityAlgorithmicDollarManager";

const NETWORK_ADDRESS = "http://localhost:8545";

task("faucet", "Sends ETH and tokens to an address")
  .addOptionalParam("receiver", "The address that will receive them")
  .addOptionalParam("manager", "The address of uAD Manager")
  .setAction(
    async (
      taskArgs: { receiver: string | null; manager: string | null },
      { ethers, getNamedAccounts }
    ) => {
      const net = await ethers.provider.getNetwork();
      if (net.name === "hardhat") {
        console.warn(
          "You are running the faucet task with Hardhat network, which" +
            "gets automatically created and destroyed every time. Use the Hardhat" +
            " option '--network localhost'"
        );
      }
      console.log(`net chainId: ${net.chainId}  `);

      // Gotta use this provider otherwise impersonation doesn't work
      // https://github.com/nomiclabs/hardhat/issues/1226#issuecomment-924352129
      const provider = new ethers.providers.JsonRpcProvider(NETWORK_ADDRESS);

      const {
        UbiquityAlgorithmicDollarManagerAddress: namedManagerAddress,
        ubq: namedTreasuryAddress,
        // curve3CrvToken: namedCurve3CrvAddress,
      } = await getNamedAccounts();

      console.log(namedManagerAddress, namedTreasuryAddress);

      const managerAddress = taskArgs.manager || namedManagerAddress;
      const [firstAccount] = await ethers.getSigners();
      const receiverAddress = taskArgs.receiver || firstAccount.address;

      await provider.send("hardhat_impersonateAccount", [namedTreasuryAddress]);
      const treasuryAccount = provider.getSigner(namedTreasuryAddress);

      console.log("Manager address: ", managerAddress);
      console.log("Treasury address: ", namedTreasuryAddress);
      console.log("Receiver address:", receiverAddress);

      const manager = (await ethers.getContractAt(
        "UbiquityAlgorithmicDollarManager",
        managerAddress,
        treasuryAccount
      )) as UbiquityAlgorithmicDollarManager;

      const uADToken = (await ethers.getContractAt(
        "ERC20",
        await manager.dollarTokenAddress(),
        treasuryAccount
      )) as ERC20;

      const uARToken = (await ethers.getContractAt(
        "ERC20",
        await manager.autoRedeemTokenAddress(),
        treasuryAccount
      )) as ERC20;

      const curveLPToken = (await ethers.getContractAt(
        "ERC20",
        await manager.stableSwapMetaPoolAddress(),
        treasuryAccount
      )) as ERC20;

      // const crvToken = (await ethers.getContractAt(
      //   "ERC20",
      //   namedCurve3CrvAddress,
      //   treasuryAccount
      // )) as ERC20;

      const ubqToken = (await ethers.getContractAt(
        "ERC20",
        await manager.governanceTokenAddress(),
        treasuryAccount
      )) as ERC20;

      const transfer = async (name: string, token: ERC20, amount: number) => {
        console.log(`${name}: ${token.address}`);
        const tx = await token.transfer(
          receiverAddress,
          ethers.utils.parseEther(amount.toString())
        );
        console.log(`  Transferred ${amount} ${name} from ${tx.from}`);
      };

      await transfer("uAD", uADToken, 1000);
      await transfer("uAR", uARToken, 1000);
      await transfer("uAD3CRV-f", curveLPToken, 1000);
      // await transfer("3CRV", crvToken, 1000);
      await transfer("UBQ", ubqToken, 1000);
    }
  );
