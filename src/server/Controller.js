// @flow
import { wagenReihung, wagenReihungStation } from './Reihung';
import axios from 'axios';
import createAuslastung from './Auslastung';
import KoaRouter from 'koa-router';
import stationSearch from './Search';
import type { Abfahrt } from 'types/abfahrten';
import type Koa from 'koa';

const useTestData = process.env.NODE_ENV === 'test';

const trainRegex = /(\w+?)?? ?(RS|STB|IRE|RE|RB|IC|ICE|EC|ECE|TGV|NJ|RJ|S)? ?(\d+\w*)/;

function getTrainType(thirdParty, trainType) {
  if ((thirdParty === 'NWB' && trainType === 'RS') || thirdParty === 'BSB') {
    return 'S';
  }
  if (thirdParty === 'FLX') {
    return 'IR';
  }
  if (thirdParty) {
    return 'RB';
  }
  if (trainType === 'ECE') {
    return 'EC';
  }

  return trainType;
}

function getTrainId(thirdParty, rawTrainType, trainId) {
  if (thirdParty === 'NWB' && rawTrainType === 'RS') {
    return `${rawTrainType}${trainId}`;
  }

  return trainId || undefined;
}

export function splitTrainType(train: string = '') {
  const parsed = trainRegex.exec(train);

  if (parsed) {
    const thirdParty = parsed[1] || undefined;
    const trainType = getTrainType(thirdParty, parsed[2]);

    return {
      thirdParty,
      trainType,
      trainId: getTrainId(thirdParty, parsed[2], parsed[3]),
    };
  }

  return {
    thirdParty: undefined,
    trainType: undefined,
    trainId: undefined,
  };
}

export default function setRoutes(koa: Koa, prefix: string = '/api') {
  const router = new KoaRouter();

  // Favendo offline?
  async function stationInfo(station: number) {
    const info = (await axios.get(`https://si.favendo.de/station-info/rest/api/station/${station}`)).data;

    return { id: info.id, title: info.title, evaId: info.eva_ids[0], recursive: info.eva_ids.length > 1 };
  }

  const longDistanceRegex = /(ICE?|TGV|ECE?|RJ).*/;

  const DBFHost = process.env.DBF_HOST || 'https://dbf.finalrewind.org';

  // http://dbf.finalrewind.org/KD?mode=marudor&backend=iris&version=2
  function evaIdAbfahrten(evaId: string) {
    return axios.get(`${DBFHost}/${evaId}?mode=marudor&backend=iris&version=4`).then(d => {
      if (d.data.error) {
        throw d.data;
      }
      const departures: Abfahrt[] = d.data.departures.map(dep => ({
        ...dep,
        // id: calculateTrainId(dep),
        ...splitTrainType(dep.train),
        longDistance: longDistanceRegex.test(dep.train),
      }));

      return departures;
    });
  }

  router
    .prefix(prefix)
    .get('/search/:searchTerm', async ctx => {
      if (useTestData) {
        ctx.body = require('./testData/search');

        return;
      }
      const { searchTerm } = ctx.params;
      const { type } = ctx.query;

      ctx.body = await stationSearch(searchTerm, type);
    })
    // https://si.favendo.de/station-info/rest/api/station/724
    .get('/station/:station', async ctx => {
      const { station } = ctx.params;

      ctx.body = await stationInfo(station);
    })
    .get('/abfahrten/:station', async ctx => {
      if (useTestData) {
        ctx.body = require('./testData/abfahrten');

        return;
      }
      const { station } = ctx.params;
      const evaId = station;

      if (evaId.length < 6) {
        ctx.status = 400;
        ctx.body = {
          message: 'Please provide a evaID',
        };
      }
      try {
        ctx.body = await evaIdAbfahrten(evaId);
      } catch (e) {
        ctx.body = e;
        ctx.status = 500;
      }
    })
    .get('/wagenstation/:train/:station', async ctx => {
      const { train, station } = ctx.params;

      try {
        ctx.body = await wagenReihungStation([train], station);
      } catch (e) {
        ctx.body = e.response.data;
      }
    })
    .get('/wagen/:trainNumber/:date', async ctx => {
      if (useTestData) {
        ctx.body = require('./testData/reihung');

        return;
      }
      const { date, trainNumber } = ctx.params;

      try {
        ctx.body = await wagenReihung(trainNumber, date);
      } catch (e) {
        ctx.body = e.response.data;
      }
    });

  const AuslastungsUser = process.env.AUSLASTUNGS_USER;
  const AuslastungsPW = process.env.AUSLASTUNGS_PW;

  if (AuslastungsUser && AuslastungsPW) {
    const auslastung = createAuslastung(AuslastungsUser, AuslastungsPW);

    // YYYYMMDD
    router.get('/auslastung/:trainNumber/:date', async ctx => {
      if (useTestData) {
        ctx.body = require('./testData/auslastung');

        return;
      }
      const { date, trainNumber } = ctx.params;

      try {
        ctx.body = await auslastung(trainNumber, date);
      } catch (e) {
        ctx.body = e.response.data;
      }
    });
  }

  koa.use(router.routes());
}
