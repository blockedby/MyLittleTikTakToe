import { ethers } from "hardhat";
import { TikTakJudgement, TikTakJudgement__factory } from "../typechain";

async function main() {
  let TJ_factory:TikTakJudgement__factory;
  let TTJ:TikTakJudgement;
  TJ_factory = await ethers.getContractFactory("TikTakJudgement");
  TTJ = await TJ_factory.deploy();

  await TTJ.deployed();
  console.log("TikTakJudgement deployed to:", TTJ.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
