#! /bin/bash
jq -Rrs -f listPlants.jq masterPlantList.tsv > plants.json
