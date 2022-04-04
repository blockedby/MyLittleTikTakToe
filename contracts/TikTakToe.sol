//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TikTakJudgement is ReentrancyGuard {
    using ECDSA for bytes32;

    address public player1;
    address public player2;
    address public winner;
    uint256 public turnTimestamp = 600;
    uint256 public lastSincTime;
    bool public isActive;
    uint8 public nextTurn;
    address[] private board = new address[](9);

    event PlayerJoined(address player);
    event GameStarted(address player1, address player2);
    event NewTurn(address player, uint256 cell);
    event GameForwarded(uint8 fromTurn, uint8 toTurn);
    event Victory(address player);
    event Draw(address player1, address player2);

    function makeTurn(uint256 cell) external {
        require(isActive, "MT1");
        require(
            (msg.sender == player1 && (nextTurn % 2) == 1) ||
                (msg.sender == player2 && (nextTurn % 2) == 0),
            "MT2"
        );
        require(cell < 9, "MT3");
        require(board[cell] == address(0), "MT4");
        _checkTimestamp(msg.sender);
        board[cell] = msg.sender;
        nextTurn++;
        _checkForWin();

        emit NewTurn(msg.sender, cell);
    }

    function requestStateSinc(
        address[] memory _board,
        uint8 _nextTurn,
        address _player1,
        address _player2,
        bytes memory signature1,
        bytes memory signature2
    ) external {
        require(
            _player1 == player1 && _player2 == player2 && _nextTurn > nextTurn,
            "RFW1"
        );
        bytes32 acceptedHash = keccak256(
            abi.encodePacked(_board, _nextTurn, _player1, _player2)
        );
        bytes32 acceptedMessage = acceptedHash.toEthSignedMessageHash();
        // check signatures
        require(
            acceptedMessage.recover(signature1) == _player1 &&
                acceptedMessage.recover(signature2) == _player2,
            "RFW2"
        );
        // check timer
        _checkTimestamp(msg.sender);
        // checked => valid state
        board = _board;
        emit GameForwarded(nextTurn, _nextTurn);
        nextTurn = _nextTurn;
        // state updated, check for win
        _checkForWin();
    }

    function _checkForWin() internal {
        require(isActive, "");
        address checked = _checkBoard();

        if (checked == address(0)) {
            // draw
            if (nextTurn == 10) {
                isActive = false;
            }
            // game continue
        } else {
            if (checked == player1) {
                isActive = false;
                winner = player1;
            // else checked == player2
            } else {
                isActive = false;
                winner = player2;
            }
        }
        // _endGame should end game if it's over
        _endGame();
    }

    function _endGame() internal nonReentrant() {
        // if game is over
        if (!isActive) {
            // if we have winner
            if (winner != address(0)) {
                emit Victory(winner);
                payable(winner).transfer(1 ether);
            // else it's draw
            } else {
                emit Draw(player1, player2);
                payable(player1).transfer(0.5 * 1 ether);
                payable(player2).transfer(0.5 * 1 ether);
            }
            // back to initial state
            player1 = address(0);
            player2 = address(0);
            board = new address[](9);
        }
    }
    // autolose if you forget about TTT, or exit game
    function checkTimestampForPlayer(address player) external {
        require(player == player1 || player == player2, "CTFP1");
        _checkTimestamp(player);
    }

    function _checkTimestamp(address player) internal {
        //  if first player should move and lose timestamp
        if (
            player == player1 &&
            (nextTurn % 2) == 1 &&
            (block.timestamp - lastSincTime > turnTimestamp)
        ) {
            // winner is player2
            winner = player2;
            isActive = false;
        //  else if second player should move and lose timestamp
        } else if (
            player == player2 &&
            (nextTurn % 2) == 0 &&
            (block.timestamp - lastSincTime > turnTimestamp)
        ) {
            // winner is player1
            winner = player1;
            isActive = false;
        }
        _endGame();
    }

    function _checkBoard() internal view returns (address) {
        for (uint256 i; i < 3; i++) {
            // check rows, 012 345 678
            if (_checkCages(i * 3, i * 3 + 1, i * 3 + 2)) {
                return board[i*3];
            }
            // check columns 036 145 258
            else if (_checkCages(i, i + 3, i + 6)) {
                return board[i];
            }
        }
        // check diagonally 048 246
        if (_checkCages(0, 4, 8)) {
            return board[4];
        // check diagonally  246
        } else if (_checkCages(2, 4, 6)) {
            return board[4];
        }
        // if no winner
        return address(0);
    }

    function _checkCages(
        uint256 a,
        uint256 b,
        uint256 c
    ) internal view returns (bool) {
        if (
            board[a] == board[b] &&
            board[b] == board[c] &&
            board[c] != address(0)
        ) {
            return true;
        } else {
            return false;
        }
    }

    function getLastState()
        external
        view
        returns (
            address[] memory,
            uint8,
            address,
            address
        )
    {
        return (board, nextTurn, player1, player2);
    }

    function iWannaPlay() external payable {
        require(!isActive, "IW0");
        require(msg.sender != player1 && msg.sender != player2, "IW1");
        require(msg.value == 0.5 * 1 ether, "IW2");

        if (player1 == address(0)) {
            player1 = msg.sender;
            emit PlayerJoined(msg.sender);
        } else {
            player2 = msg.sender;
            winner = address(0);

            emit PlayerJoined(msg.sender);
            emit GameStarted(player1, player2);
            isActive = true;
            nextTurn = 1;
            lastSincTime = block.timestamp;
        }
    }
}
