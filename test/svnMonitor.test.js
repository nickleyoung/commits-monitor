const sinon = require('sinon');
const rewire = require('rewire');
const axios = require('axios');
const expect = require('chai').expect;
const childProcess = require('child_process');

const svnMonitor = rewire('../src/svnMonitor');
describe('svnMonitor test', () => {
    let suite = null;
    const initialCplaneRepo = {
        _id: '56dd489df388a6459e34ee2e',
        cut_url: 'isource/svnroot/BTS_SC_CPLANE/trunk',
        'sc': 'C-PLANE',
        'url': 'http://beisop60.china.nsn-net.net/isource/svnroot/BTS_SC_CPLANE/trunk',
        'updatetime': 1548174617,
        removed: '0',
        feature_validation: '0',
        repo_type: 'svn',
        username: 'COOP',
        'repo_name': 'trunk',
        'bl': '4G RAN',
        classify: '',
        actived: '1',
        'scantime': 1548174378,
        'last_revision': '701992',
        DT_RowId: '56dd489df388a6459e34ee2e',
        replaceUrl: 'https://beisop60.china.nsn-net.net/isource/svnroot/BTS_SC_OAM_FZM/branches/18A_C5',
        skipCmd: false
    };
    const initialRepoData = {
        pass: 'test',
        data: [initialCplaneRepo]
    };
    const fakeSvnLogData = '------------------------------------------------------------------------\n' +
        'r701965 | apn001 | 2019-01-22 08:23:52 -0800 (Tue, 22 Jan 2019) | 1 line\n' +
        '\n' +
        '[int.4985] Rename Ans1DataClasses to Asn1. Explicitly in all SC_Common, indirectly (via preprocessor) in other code (next try - red CI)\n' +
        '------------------------------------------------------------------------\n' +
        'r701966 | wielgus | 2019-01-22 08:31:15 -0800 (Tue, 22 Jan 2019) | 1 line\n' +
        '\n' +
        'csa fixes for ttcn3 longlines\n' +
        '------------------------------------------------------------------------\n' +
        'r701971 | piszczek | 2019-01-22 09:40:52 -0800 (Tue, 22 Jan 2019) | 1 line\n' +
        '\n' +
        'LTE4530-A-b1: Unwipped two SCTs\n' +
        '------------------------------------------------------------------------\n' +
        'r701975 | prznowak | 2019-01-22 10:48:37 -0800 (Tue, 22 Jan 2019) | 1 line\n' +
        '\n' +
        'INT.5269 EnDualConnSgnbAddService refactoring. RRC_Connection_Reconfiguration merge.Rework after review_2.\n' +
        '------------------------------------------------------------------------\n' +
        'r701977 | apn001 | 2019-01-22 11:57:01 -0800 (Tue, 22 Jan 2019) | 1 line\n' +
        '\n' +
        '[int.4985] Rename Asn1DataClasses to Asn1 in CELLC\n' +
        '------------------------------------------------------------------------\n' +
        'r701979 | apn001 | 2019-01-22 12:09:34 -0800 (Tue, 22 Jan 2019) | 1 line\n' +
        '\n' +
        '[int.4985] Rename Asn1DataClasses to Asn1 in ENBC\n' +
        '------------------------------------------------------------------------\n' +
        'r701980 | apn001 | 2019-01-22 12:13:09 -0800 (Tue, 22 Jan 2019) | 1 line\n' +
        '\n' +
        '[int.4985] Rename Asn1DataClasses to Asn1 in MCEC\n' +
        '------------------------------------------------------------------------\n' +
        'r701981 | apn001 | 2019-01-22 12:16:10 -0800 (Tue, 22 Jan 2019) | 1 line\n' +
        '\n' +
        '[int.4985] Rename Asn1DataClasses to Asn1 in RROM\n' +
        '------------------------------------------------------------------------\n' +
        'r701984 | apn001 | 2019-01-22 12:27:07 -0800 (Tue, 22 Jan 2019) | 1 line\n' +
        '\n' +
        '[int.4985] Rename Asn1DataClasses to Asn1 in UEC/.../CP_UeMeasurementProcessing\n' +
        '------------------------------------------------------------------------\n';
    const fakeSvnDiffData = ' cpp/aam/dm/adaptor/Aal2PathAdaptor.C                     |   56 \n' +
        ' itrBuild/Variants/targetBD.xml                           |    4 \n' +
        ' itrBuild/etc/emake.history                               | 1187 ++++-----------\n' +
        ' itrWimax/small_rootfs_proj/filesystem/fs/etc/group       |   43 \n' +
        ' itrWimax/small_rootfs_proj/filesystem/fs/etc/perm_passwd |   30 \n' +
        ' itrWimax/small_rootfs_proj/filesystem/fs/etc/perm_shadow |   26 \n' +
        ' 6 files changed, 368 insertions(+), 978 deletions(-)\n';
    beforeEach((done) => {
        process.env.NODE_ENV = 'test';
        suite = {
            sandbox: sinon.createSandbox(),
            main: svnMonitor.__get__('main')
        };
        done();
    });

    afterEach((done) => {
        suite.sandbox.restore();
        suite = null;
        done();
    });

    describe('Function main() test', () => {
        it('should cron all the commits of cplane trunk and update the last_revision of cplane repo success', (done) => {
            const expectResult = [{ errorArray: [] }];
            suite.sandbox.stub(axios, 'get').returns(Promise.resolve({data: initialRepoData}));
            suite.sandbox.stub(axios, 'post').returns(Promise.resolve({}));
            suite.sandbox.stub(childProcess, 'exec').callsFake((cmdStr, option, cb) => {
                const svnLogReg = new RegExp('svn log');
                if (svnLogReg.test(cmdStr)) {
                    return cb(null,fakeSvnLogData);
                }
                return cb(null,fakeSvnDiffData);
            });
            suite.main((err, result) => {
                expect(err).to.eql(null);
                expect(err).to.eql(null);
                expect(result).to.eql(expectResult);
                done();
            });
        });

        it('expect err when get rejection of get repo data', (done) => {
            const response = {
                response: {
                    data: 'Test data',
                    status: 504
                }
            };

            suite.sandbox.stub(axios, 'get').returns(Promise.reject(response));
            suite.main((err) => {
                expect(err).to.eql(`504\nTest data`);
                done();
            });
        });

        it('expect err obj in result when get rejection of post data', (done) => {
            const response = {
                response: {
                    data: 'Test data',
                    status: 504
                }
            };
            suite.sandbox.stub(axios, 'get').returns(Promise.resolve({data: initialRepoData}));
            suite.sandbox.stub(axios, 'post').returns(Promise.reject(response));
            suite.sandbox.stub(childProcess, 'exec').callsFake((cmdStr, option, cb) => {
                const svnLogReg = new RegExp('svn log');
                if (svnLogReg.test(cmdStr)) {
                    return cb(null,fakeSvnLogData);
                }
                return cb(null,fakeSvnDiffData);


            });
            suite.main((err, result) => {
                expect(err).to.eql(null);
                expect(result[0].errorArray.length !== 0).to.eql(true);
                done();
            });
        });
    });
});
