#bin/bash

rm -r ./files/pdf-files/*
rm -r ./files/xml-files/*
rm -r ./files/pdf-preview-images/*
rm -r ./files/chart_data.db

curl -u root:CPpassword -d '<database>pdfs</database>'   http://localhost:8081/api/servers/a30a1b0d8cab0269f0cdd9bed98fa49c5283d5cd/stop_database

sleep 2;

curl -u root:CPpassword -d '<database>pdfs</database><types><type>log</type><type>index</type><type>data</type></types>' http://localhost:8081/api/servers/a30a1b0d8cab0269f0cdd9bed98fa49c5283d5cd/remove_data

sleep 2;

curl -u root:CPpassword -d '<database>pdfs</database>'   http://localhost:8081/api/servers/a30a1b0d8cab0269f0cdd9bed98fa49c5283d5cd/start_database

