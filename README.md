# Bomb Busters Digital

A multiplayer digital adaptation of **Bomb Busters**, built with **JavaScript and Firebase Realtime Database**.

Players cooperate to identify and cut hidden wires while avoiding the bomb.

## Features

* Real-time multiplayer
* Private player hands + shared table
* Turn-based wire cutting
* Solo and duo cuts
* Detonator system
* Hints and equipment
* Mission-based gameplay
* Reconnection support

## Tech Stack

* JavaScript
* HTML / CSS
* Firebase Realtime Database

## How It Works

The game uses a **shared table + private player devices** approach:

**Table** → public game information
**Player device** → private hand information

This preserves the hidden-information aspect of the physical game while allowing players to play together online.

## Screenshots

*Add screenshots or a short gameplay GIF here.*

## Play

https://albertbenedict.github.io/bomb-busters/

## Current Status

The project is still under development. Core multiplayer gameplay is implemented, with additional missions, polish, and improvements planned.

## What I Learned

* Real-time multiplayer state synchronization
* Managing hidden information across clients
* Structuring game logic separately from UI
* Handling multiplayer sessions and reconnections
* Designing a digital version of a physical board game
