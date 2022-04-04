import { expect } from "chai";
import { ethers } from "hardhat";
import { TikTakJudgement, TikTakJudgement__factory } from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, ContractTransaction } from "ethers";

const zeroAddress = ethers.constants.AddressZero;
let alice: SignerWithAddress;
let bob: SignerWithAddress;
let TJ_factory: TikTakJudgement__factory;
let TJ: TikTakJudgement;

interface ISigMessage {
  signature: string,
  message: Uint8Array
}
interface IBoardState {
  board: string[],
  nextTurn: number,
  player1: string,
  player2: string
}
async function passTime(time: number) {
  await ethers.provider.send('evm_increaseTime', [time]);
  await ethers.provider.send("evm_mine", []);
  console.log("                  (" + time + " seconds passed)");
}
async function SignState(signer: SignerWithAddress, state: IBoardState) {
  const cryptedMessage = ethers.utils.solidityKeccak256(
    ["address[]", "uint8", "address", "address"], [state.board, state.nextTurn, state.player1, state.player2]
  );
  const arrayify = ethers.utils.arrayify(cryptedMessage);
  const sig = await signer.signMessage(arrayify);
  return [sig, arrayify];
}
async function signMessage(signer: SignerWithAddress, state: IBoardState) {
  const cryptedMessage = ethers.utils.solidityKeccak256(
    ["address[]", "uint8", "address", "address"], [state.board, state.nextTurn, state.player1, state.player2]
  );
  const arrayify = ethers.utils.arrayify(cryptedMessage);
  const sig = await signer.signMessage(arrayify);
  const message: ISigMessage = {
    signature: sig,
    message: arrayify
  }
  return message;
}
function MakeTurn(signer: SignerWithAddress, state: IBoardState, cell: number) {
  let newState: IBoardState = state;
  // ???? it's just a typescript
  newState.board = state.board.filter(cel => cel);
  newState.board[cell] = signer.address;
  newState.nextTurn = newState.nextTurn + 1;
  return newState;
}
function FormatState(state: [string[], number, string, string]) {
  let newState: IBoardState = {
    board: state[0],
    nextTurn: state[1],
    player1: state[2],
    player2: state[3]
  }
  return newState;
}
describe("TikTakJudgement", function () {
  beforeEach("", async () => {
    [alice, bob] = await ethers.getSigners();
    TJ_factory = await ethers.getContractFactory("TikTakJudgement");
    TJ = await TJ_factory.deploy();
    await TJ.deployed();
  })
  describe("Start of game", async () => {
    it("Should start the game", async () => {
      await expect(TJ.connect(alice).iWannaPlay({ value: ethers.utils.parseEther("0.5") })).to.emit(TJ, "PlayerJoined").withArgs(alice.address);
      await expect(TJ.connect(bob).iWannaPlay({ value: ethers.utils.parseEther("0.5") })).to.emit(TJ, "GameStarted").withArgs(alice.address, bob.address);
    });
  });
  describe("OffChainTest", async () => {
    let initialState: IBoardState;
    beforeEach("Start game OffChain", async () => {
      await TJ.connect(alice).iWannaPlay({ value: ethers.utils.parseEther("0.5") });
      await TJ.connect(bob).iWannaPlay({ value: ethers.utils.parseEther("0.5") });
      initialState = FormatState(await TJ.getLastState());
    });
    it("Should make a turn offchain and sync it", async () => {
      let newState = MakeTurn(alice, initialState, 0);
      // alice create and sign message
      const [alice1sig, alice1message] = await SignState(alice, newState);
      let checkedAddress = ethers.utils.recoverAddress(ethers.utils.hashMessage(alice1message), alice1sig);
      // check signature
      expect(checkedAddress).to.eq(alice.address);
      // sign message by bob
      const [bob1sig] = await SignState(bob, newState);
      checkedAddress = ethers.utils.recoverAddress(ethers.utils.hashMessage(alice1message), bob1sig);
      // check signature
      expect(checkedAddress).to.eq(bob.address);
      // sinc state
      expect(await
        TJ.connect(alice).requestStateSinc(
          newState.board, newState.nextTurn, newState.player1, newState.player2, alice1sig, bob1sig
        )
      ).to.emit(TJ, "GameForwarded").withArgs(1, 2);
      // get state and format
      const contractState = FormatState(await TJ.getLastState());
      // I don't no how to compare boards... it's error, so I check by strings:
      for (let index = 0; index < contractState.board.length; index++) {
        expect(contractState.board[index]).to.eq(newState.board[index])
      }
      // check other params
      expect(contractState.nextTurn).to.eq(newState.nextTurn);
      expect(contractState.player1).to.eq(newState.player1);
      expect(contractState.player2).to.eq(newState.player2);

    });
    it("Alice should win offchain", async () => {
      let aliceState = FormatState( await TJ.getLastState());
      aliceState.board =[
        alice.address,zeroAddress,bob.address,
        alice.address,bob.address,zeroAddress,
        alice.address,zeroAddress,zeroAddress
      ]; /* next turn is 6 */
      aliceState.nextTurn = 6;
      const aliceMessage = await signMessage(alice,aliceState);
      const bobMessage = await signMessage(bob,aliceState);
      await TJ.connect(alice).requestStateSinc(
        aliceState.board,aliceState.nextTurn,aliceState.player1,aliceState.player2,
        aliceMessage.signature,bobMessage.signature
      );
      expect(await TJ.winner()).to.eq(alice.address);
    });
    it("Bob should win offchain", async () => {
      let bobState = FormatState( await TJ.getLastState());
      bobState.board =[
        alice.address,alice.address,bob.address,
        bob.address,bob.address,bob.address,
        alice.address,alice.address,zeroAddress
      ]; /* next turn is 9 */
      bobState.nextTurn = 9;
      const aliceMessage = await signMessage(alice,bobState);
      const bobMessage = await signMessage(bob,bobState);
      // check balance and winner
      expect(await TJ.connect(bob).requestStateSinc(
        bobState.board,bobState.nextTurn,bobState.player1,bobState.player2,
        aliceMessage.signature,bobMessage.signature
      )).changeEtherBalance(alice,ethers.utils.parseEther("1"));
      expect(await TJ.winner()).to.eq(bob.address);
    });
    it("It should be draw", async () => {
      let drawState = FormatState( await TJ.getLastState());
      drawState.board =[
        alice.address,alice.address,bob.address,
        bob.address,alice.address,alice.address,
        alice.address,bob.address,bob.address
      ]; /* next turn is 10 */
      drawState.nextTurn = 10;
      const aliceMessage = await signMessage(alice,drawState);
      const bobMessage = await signMessage(bob,drawState);
      const tx = TJ.connect(bob).requestStateSinc(
        drawState.board,drawState.nextTurn,drawState.player1,drawState.player2,
        aliceMessage.signature,bobMessage.signature
      );
      // check events and balances
      expect(await tx)
      .to.emit(TJ,"GameForwarded").withArgs(1,10)
      .to.emit(TJ,"Draw").withArgs(alice.address,bob.address)
      .changeEtherBalances([alice,bob],[ethers.utils.parseEther("0.5"),ethers.utils.parseEther("0.5")]);
      expect (await TJ.winner()).to.eq(zeroAddress)
    });
    describe("Timestamp problems", async () => {
      it("Alice should lose without any moves", async () => {
        await passTime(600);
        expect(await TJ.connect(bob).checkTimestampForPlayer(alice.address))
        .to.emit(TJ,"Victory").withArgs(bob.address)
        .changeEtherBalance(bob,ethers.utils.parseEther("1"));
      });
      it("Bob should lose without any moves", async () => {
        await TJ.connect(alice).makeTurn(8);
        await passTime(610);
        expect(await TJ.connect(bob).checkTimestampForPlayer(bob.address))
        .to.emit(TJ,"Victory").withArgs(alice.address)
        .changeEtherBalance(alice,ethers.utils.parseEther("1"));
        expect(await TJ.winner()).to.eq(alice.address);
      });
    });
    describe("Cheating scenarios", async () => {
      let zeroAddress:string;
      
      before("Make few moves", async () => {
        zeroAddress = ethers.constants.AddressZero;

      });
      it("Should cheat with changing move", async () => {
        const normalState = FormatState(await TJ.getLastState());
        normalState.board = [
          alice.address, zeroAddress, alice.address,
          zeroAddress, zeroAddress, zeroAddress,
          bob.address, alice.address, bob.address
        ];
        normalState.nextTurn = 6;
        const bobMessage = await signMessage(bob,normalState);
        const aliceMessage = await signMessage(alice,normalState);
        let brokenState = normalState;
        brokenState.board = [
          alice.address, zeroAddress, alice.address,
          alice.address, zeroAddress, zeroAddress,
          bob.address, zeroAddress, bob.address
        ];
        //    a   0   a
        //    a   0   0
        //    b   0   b
        // create new sig
        const brokenMessage = await signMessage(bob, brokenState);
        // try to sinc state
        let lastAliceMessageWithSig = signMessage
        await expect(TJ.connect(bob).requestStateSinc(
          brokenState.board, brokenState.nextTurn,
          brokenState.player1, brokenState.player2,
          aliceMessage.signature, brokenMessage.signature
        )).to.be.revertedWith("RFW2");
      });
      it("Should cheat with two moves", async () => {
        const normalState = FormatState(await TJ.getLastState());
        normalState.board = [
          alice.address, zeroAddress, alice.address,
          zeroAddress, zeroAddress, zeroAddress,
          bob.address, alice.address, bob.address
        ];
        normalState.nextTurn = 6;
        const bobMessage = await signMessage(bob,normalState);
        const aliceMessage = await signMessage(alice,normalState);

        let brokenState = normalState;
        brokenState.board = [
          alice.address, bob.address, alice.address,
          zeroAddress, bob.address, zeroAddress,
          bob.address, alice.address, bob.address
        ]
        // broken state is 
        //    a   b   a
        //    0   b   0
        //    b   a   b
        const brokenMessage = await signMessage(bob, brokenState);
        // try to sinc state
        await expect(TJ.connect(bob).requestStateSinc(
          brokenState.board, brokenState.nextTurn,
          brokenState.player1, brokenState.player2,
          aliceMessage.signature, brokenMessage.signature
        )).to.be.revertedWith("RFW2");
      });
      it("Should cheat with players", async () => {
        // try to sinc state
        const normalState = FormatState(await TJ.getLastState());
        normalState.board = [
          alice.address, zeroAddress, alice.address,
          zeroAddress, zeroAddress, zeroAddress,
          bob.address, alice.address, bob.address
        ];
        normalState.nextTurn = 6;
        const bobMessage = await signMessage(bob,normalState);
        const aliceMessage = await signMessage(alice,normalState);

        let brokenState = normalState;
        brokenState.player1 = bob.address;
        const brokenMessage = await signMessage(bob, brokenState);
        // bob try to cheat
        await expect(TJ.connect(bob).requestStateSinc(
          brokenState.board, brokenState.nextTurn,
          brokenState.player2, brokenState.player2,
          aliceMessage.signature, brokenMessage.signature
        )).to.be.revertedWith("RFW1");
        // alice also can't change players
        const aliceBrokenMessage = await signMessage(alice, brokenState);
        await expect(TJ.connect(bob).requestStateSinc(
          brokenState.board, brokenState.nextTurn,
          brokenState.player2, brokenState.player2,
          aliceBrokenMessage.signature, brokenMessage.signature
        )).to.be.revertedWith("RFW1");
      });
      it("Should cheat with trying to reverse state", async () => {
        const zeroAddress = ethers.constants.AddressZero;
        const state6: IBoardState = {
          board: [alice.address, zeroAddress, alice.address,
            zeroAddress, zeroAddress, zeroAddress,
          bob.address, alice.address, bob.address],
          nextTurn: 6,
          player1: alice.address,
          player2: bob.address
        };
        // initial state is 
        //    a   0   a
        //    0   0   0
        //    b   a   b
        const aliceMessage = await signMessage(alice, state6);
        const bobMessage = await signMessage(bob, state6);
        // state before is 
        //    a   0   a
        //    0   0   0
        //    b   0   b
        const state5: IBoardState = {
          board: [alice.address, zeroAddress, alice.address,
            zeroAddress, zeroAddress, zeroAddress,
          bob.address, zeroAddress, bob.address],
          nextTurn: 5,
          player1: alice.address,
          player2: bob.address
        };;
        const aliceOldMessage = await signMessage(alice, state5);
        const bobOldMessage = await signMessage(bob, state5);
        // console.log(state4)
        // sinc state to 6
        await TJ.connect(alice).requestStateSinc(
          state6.board, state6.nextTurn, state6.player1, state6.player2,
          aliceMessage.signature, bobMessage.signature
        );
        // try sinc 5 state
        await expect(TJ.connect(alice).requestStateSinc(
          state5.board, state5.nextTurn, state5.player1, state5.player2,
          aliceOldMessage.signature, bobOldMessage.signature
        )).to.be.revertedWith("RFW1");
      });
      // it("Should start the game", async () => {
      // });
    });
  });
  describe("OnChainTest", async () => {
    beforeEach("Start the game", async () => {
      await expect(TJ.connect(alice).iWannaPlay({ value: ethers.utils.parseEther("0.5") })).to.emit(TJ, "PlayerJoined").withArgs(alice.address);
      await expect(TJ.connect(bob).iWannaPlay({ value: ethers.utils.parseEther("0.5") })).to.emit(TJ, "GameStarted").withArgs(alice.address, bob.address);
    })
    it("Should make first turn", async () => {
      // wrong order
      await expect(TJ.connect(bob).makeTurn(0)).to.be.revertedWith("");
      await TJ.connect(alice).makeTurn(0);
    });
    it("Should check stages", async () => {
      const initialStage = await TJ.getLastState();
      await TJ.connect(alice).makeTurn(0);
      const changedStage = await TJ.getLastState();
      // without turns
      expect(initialStage[0][0]).to.eq(ethers.constants.AddressZero);
      // next turn is first
      expect(initialStage[1]).to.eq(1);
      // first player is alice
      expect(initialStage[2]).to.eq(alice.address);
      // second player is bob
      expect(initialStage[3]).to.eq(bob.address);
      // alice made a turn
      expect(changedStage[0][0]).to.eq(alice.address);
      // next is bob's turn
      expect(changedStage[1]).to.eq(2);
      // players are not changed
      expect(initialStage[2]).to.eq(changedStage[2]);
      expect(initialStage[3]).to.eq(initialStage[3]);
    });
    it("Should make second turn", async () => {
      // wrong order
      await expect(TJ.connect(bob).makeTurn(0)).to.be.revertedWith("");
      await TJ.connect(alice).makeTurn(0);
      await TJ.connect(bob).makeTurn(1);
    });
    describe("Alice should win", async () => {
      it("Alice should win gorizontally", async function () {
        await TJ.connect(alice).makeTurn(0);
        await TJ.connect(bob).makeTurn(3);
        await TJ.connect(alice).makeTurn(1);
        await TJ.connect(bob).makeTurn(4);
        await expect(TJ.connect(alice).makeTurn(2)).to.emit(TJ, "Victory").withArgs(alice.address);
      });
      it("Alice should win vertically", async function () {
        await TJ.connect(alice).makeTurn(0);
        await TJ.connect(bob).makeTurn(2);
        await TJ.connect(alice).makeTurn(3);
        await TJ.connect(bob).makeTurn(5);
        await expect(TJ.connect(alice).makeTurn(6)).to.emit(TJ, "Victory").withArgs(alice.address);
      });
      it("Alice should win diagonally", async function () {
        // a 0 b
        // 0 a b
        // 0 0 a
        await TJ.connect(alice).makeTurn(0);
        await TJ.connect(bob).makeTurn(2);
        await TJ.connect(alice).makeTurn(4);
        await TJ.connect(bob).makeTurn(5);
        await expect(TJ.connect(alice).makeTurn(8)).to.emit(TJ, "Victory").withArgs(alice.address);
      });
      it("Alice should win another diagonally", async function () {
        // b 0 a
        // 0 a b
        // a 0 0
        await TJ.connect(alice).makeTurn(2);
        await TJ.connect(bob).makeTurn(0);
        await TJ.connect(alice).makeTurn(4);
        await TJ.connect(bob).makeTurn(5);
        await expect(TJ.connect(alice).makeTurn(6)).to.emit(TJ, "Victory").withArgs(alice.address);
      });
      describe("Balance should change", async () => {
        let txA: Promise<ContractTransaction>;
        beforeEach("", async () => {
          await TJ.connect(alice).makeTurn(0);
          await TJ.connect(bob).makeTurn(2);
          await TJ.connect(alice).makeTurn(4);
          await TJ.connect(bob).makeTurn(5);
          txA = TJ.connect(alice).makeTurn(8);

        });
        it("Alice balance should change", async () => {
          await expect(await txA).to.changeEtherBalance(alice, ethers.utils.parseEther("1"));
        });
        it("Bob balance shouldn't change", async () => {
          await expect(await txA).to.changeEtherBalance(bob, 0);
        })
        it("Contract balance should change", async () => {
          await expect(await txA).to.changeEtherBalance(TJ, ethers.utils.parseEther("-1"));
        })
      });
    });
  });
});
