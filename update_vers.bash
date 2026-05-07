#! /bin/bash
jq --arg date "$(date +'%Y-%m-%d-%H-%M-%S')" '.version = $date' version.json > version.tmp && mv version.tmp version.json
