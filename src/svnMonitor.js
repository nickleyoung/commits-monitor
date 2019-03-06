/*
 * monitor the changes of SVN repository like MAC_TDD_PS
 * and submit all commits to falcon
 */

const axios = require('axios');
const qs = require('qs');

const _ = require('lodash-node');
const logger = require('./logging').getLogger('scripts/svnMonitor');
const async = require('async');
const childProcess = require('child_process');
const moment = require('moment');
// const utils = require('../utils');

const POST_API_URL = 'http://10.159.218.170:3000/api/commits/';
const REPO_GET_URL = 'http://10.159.218.170:3000/api/commits/config/repo_get?who=robot&from=svn_monitor&repo_type=svn';
const REPO_POST_URL = 'http://10.159.218.170:3000/api/commits/config/repo_post';
// const USERS_POST_URL = 'http://10.159.218.170:3000/api/users';

const BEISOP = 'https://beisop60.china.nsn-net.net/';
const SVNE1 = 'https://svne1.access.nsn.com/';
const BEISOP_REG = new RegExp(BEISOP, 'i');
const HTTP_REG = new RegExp(/http.*?\..*?\//);
const MAX_COMMIT_COUNT = 8;
const EXEC_OPTION = {
    timeout: 1 * 60 * 1000,
    maxBuffer: 5000 * 1024
};
const AXIOS_OPTION = {
    timeout: 1 * 60 * 1000
};

const USER = 'citdlte';
let PASSWD = 'nokia@123';
const SVN_OPTS = '--non-interactive --no-auth-cache --trust-server-cert';
const PATH_NOT_FOUND = 'path not found';
const PATH_NOT_FOUND_REG = new RegExp(PATH_NOT_FOUND, 'i');

function noop() {}

function processExit(num) {
    if (process.env.NODE_ENV !== 'test') {
        process.exit(num);
    }
}

function preReplaceUrl(url, confRow, cmdStr, cb) {
    let replaceUrl = '';
    if (BEISOP_REG.test(url)) {
        replaceUrl = url;
    } else {
        replaceUrl = (url || '').replace(HTTP_REG, BEISOP);
    }
    async.waterfall([(scb) => {
        const execCmd = `${cmdStr} ${replaceUrl} -r HEAD`;
        childProcess.exec(execCmd, EXEC_OPTION, (err, stdout) => {
            if (err) {
                return scb(null, false);
            }

            if (stdout) {
                confRow.replaceUrl = replaceUrl;
                confRow.skipCmd = false;
                return scb(null, true);
            }
            return scb(null, false);

        });
    }, (validated, scb) => {
        if (validated) {
            return scb(null);
        }
        replaceUrl = (url || '').replace(HTTP_REG, SVNE1);
        const execCmd = `${cmdStr} ${replaceUrl} -r HEAD`;
        childProcess.exec(execCmd, EXEC_OPTION, (err, stdout) => {
            if (err) {
                confRow.skipCmd = true;
                console.log(err);
                return scb(null);
            }
            if (stdout) {
                confRow.replaceUrl = replaceUrl;
                confRow.skipCmd = false;
                return scb(null);
            }
            confRow.skipCmd = true;
            return scb(null);

        });

    }], (err) => {
        if (err) {
            return cb(err);
        }
        const confInfo = `${confRow.hasOwnProperty('sc') ? confRow['sc'] : 'NA'}\t` +
            `${confRow.hasOwnProperty('url') ? confRow['url'] : 'NA'}\t` +
            `@${confRow.hasOwnProperty('last_revision') ? confRow['last_revision'] : 'NA'}\t` +
            `${replaceUrl ? replaceUrl : 'NA'}`;
        logger.info(confInfo);
        return cb(null, confRow);
    });
}

function getRepo(type, cb) {
    axios.get(REPO_GET_URL)
        .then(({data}) => {
            if (!data.hasOwnProperty('pass')) {
                const errMsg = 'Citdlte password lost! exit.';
                return cb(errMsg);
            }
            if (type === 'robot') {
                if (data.hasOwnProperty(data) && (data.data || [].length === 0)) {
                    logger.info('Repository config is empty.');
                    return cb(null, data);
                }
                const confArray = data.data || [];
                async.mapLimit(confArray, confArray.length, (confRow, scb) => {

                    const svnUser = confRow.hasOwnProperty('svn_user') ? confRow.svn_user : USER;
                    const svnPassword = confRow.hasOwnProperty('svn_password') ? confRow.svn_password : data['pass'];
                    const url = confRow.url;
                    const cmdStr = `svn log --username ${svnUser} --password ${svnPassword}`;
                    preReplaceUrl(url, confRow, cmdStr, scb);
                }, (err, results) => {
                    if (err) {
                        return cb(err);
                    }
                    data.data = results;
                    return cb(null, data);
                });
            } else {
                return cb(null, data);
            }
        }, ({response}) => {
            const {status, data} = response;
            return cb(`${status}\n${data}`);
        }).catch(cb);
}

function analyzeSvnLog(output) {
    const records = _.compact(output.split(new RegExp(`\n-{72}\n|^-{72}`)));
    const commitArray = [];
    (records || []).forEach((record, i) => {
        const lines = record.split('\n');
        const firstLineInfo = (lines[0] || '').split('|');
        const revision = (firstLineInfo[0] || '').trim().substring(1);
        const author = firstLineInfo[1] || ''.trim();
        const date = moment((firstLineInfo[2] || '').trim()).unix();
        let message = '';
        for (let i = 1; i < lines.length; i++) {
            message = `${message}${lines[i]}\n`;
        }
        message = message.trim();
        const commit = {revision, author, date, message};
        if (i) {
            commit.lastRevision = commitArray[i - 1].revision;
        }
        commitArray.push(commit);
    });
    return commitArray.slice(1);
}

function analyzeSvnDiff(output) {
    const lines = (output || '').trim().split('\n');
    const changeFiles = [];
    let fileChanged = 0;
    let totalLoc = 0;
    for (let i = 0; i < lines.length - 1; i++) {
        fileChanged++;
        const line = lines[i];
        const lineInfo = line.split('|');
        const changeFile = (lineInfo[0] || '').trim();
        const LOC_REG = new RegExp(/(\d+)/);
        const loc = (lineInfo[1] || '').trim().match(LOC_REG)[0];
        totalLoc += +loc;
        changeFiles.push({changeFile, loc});
    }
    if (fileChanged === 0){
        totalLoc = "NA";
    }
    const diffData = {loc: totalLoc, changeFiles, fileChanged};
    return (diffData);
}

// function postUser(ldap, cb) {
//     if (ldap) {
//         const postData = {
//             uid: ldap.uid,
//             mail: ldap.mail,
//             nsnManagerName: ldap.nsnManagerName,
//             nsnManagerAccountName: ldap.nsnManagerAccountName,
//             nsnBusinessGroupName: ldap.nsnBusinessGroupName,
//             nsnBusinessGroupShortName: ldap.nsnBusinessGroupShortName,
//             ou: ldap.ou,
//             nsnDivisionShortName: ldap.nsnDivisionShortName,
//             nsnTeamName: ldap.nsnTeamName,
//             nsnTeamShortName: ldap.nsnTeamShortName
//         };
//         const postDataString = qs.stringify(postData);
//         const showInfo = JSON.stringify(postData);
//         axios.post(USERS_POST_URL, postDataString)
//             .then(() => {
//                 const info = `Post user info ${showInfo} to coop`;
//                 logger.info(info);
//                 return cb();
//             }, ({response}) => {
//                 const {status, data} = response;
//                 return cb(`${status}\n${data}\n${showInfo}`);
//             })
//             .catch(cb);
//     } else {
//         return cb();
//     }
// }

function svnLog(params, cb) {
    const {replaceUrl, lastRevision, svnUser, svnPassword, dtRowId} = params;
    let cmdStr = `svn log --username ${svnUser} --password ${svnPassword} ${SVN_OPTS} ${replaceUrl}`;
    if (lastRevision) {
        cmdStr = `${cmdStr} -r ${lastRevision}:HEAD --limit ${MAX_COMMIT_COUNT + 1}`;
    } else {
        cmdStr = `${cmdStr} -r 0:HEAD --limit ${MAX_COMMIT_COUNT + 1}`;
    }
    const showCmd = cmdStr.replace(svnPassword, '******');
    logger.info(`Execute command ${showCmd}`);
    childProcess.exec(cmdStr, EXEC_OPTION, (err, stdout) => {
        if (err) {
            if (PATH_NOT_FOUND_REG.test(err.toString())) {
                const lastRevisionData = {};
                lastRevisionData['rowid'] = dtRowId;
                lastRevisionData['actived'] = '0';
                lastRevisionData['username'] = 'COOP: Path not found';
                postLastRevisions([lastRevisionData], cb);
            } else {
                return cb(err);
            }
        }
        if (stdout) {
            const commitArray = analyzeSvnLog(stdout);
            return cb(null, commitArray);
        }
        return cb(null, []);

    });
}

function svnDiff(params, cb) {
    const {replaceUrl, lastRevision, svnUser, svnPassword, revision} = params;
    const cmdStr = `svn diff --username ${svnUser} --password ${svnPassword} ${SVN_OPTS} -r${lastRevision}` +
        `:${revision} ${replaceUrl} | diffstat -p 0`;
    const showCmd = cmdStr.replace(svnPassword, '******');
    logger.info(`Execute command ${showCmd}`);
    childProcess.exec(cmdStr, EXEC_OPTION, (err, stdout) => {
        if (err) {
            return cb(err);
        }
        if (stdout) {
            const svnDiffData = analyzeSvnDiff(stdout);
            return cb(null, svnDiffData);
        }
        return cb(null, {});

    });
}

// function getLdapInfo(author, cb) {
//     if (author) {
//         const filter = `uid=${author}`;
//         utils.getLdapInfo(filter, cb);
//     } else {
//         return cb();
//     }
// }

function handleCommits(params, cb) {
    let lastDate = 0;
    const {
        repoName, scRepo, replaceUrl, svnUser,
        svnPassword, commits
    } = params;
    const postCommits = [];
    let newLastRevision = params.lastRevision;
    if (commits.length) {
        newLastRevision = commits[commits.length - 1].lastRevision;
    }
    const errorArray = [];
    async.each(commits, (commit, commitCb) => {
        const {revision, author, date, message, lastRevision} = commit;
        if (date < lastDate) {
            return commitCb(null);
        }
        lastDate = date;

        svnDiff({replaceUrl, lastRevision, svnUser, svnPassword, revision}, (err, svnDiffData) => {
            if (err) {
                errorArray.push(err);
            }
            const commit = {
                revision,
                author,
                date,
                message,
                branch: repoName.toLowerCase(),
                path: scRepo,
                repo_type: 'svn',
                parents: [lastRevision],
                loc: svnDiffData ? svnDiffData.loc || 'NA' : 'NA',
                changeFiles: svnDiffData ? svnDiffData.changeFiles || [] : null,
                file_changed: svnDiffData ? svnDiffData.fileChanged || 0 : null
            };
            postCommits.push(commit);
            return commitCb();
        });

        // getLdapInfo(author, (err, ldap) => {
        //     if (err) {
        //         errorArray.push(err);
        //     }
        //     async.parallel({
        //         postUserData(subCb) {
        //             if (lastRevision && revision !== lastRevision) {
        //                 postUser(ldap, subCb);
        //             } else {
        //                 return subCb();
        //             }
        //         },
        //         svnDiffData(subCb) {
        //             svnDiff({replaceUrl, lastRevision, svnUser, svnPassword, revision}, subCb);
        //         }
        //     }, (err, obj) => {
        //         if (err) {
        //             errorArray.push(err);
        //         }
        //         const {svnDiffData} = obj;
        //         const commit = {
        //             revision,
        //             author,
        //             displayname: ldap ? ldap.displayName || null : null,
        //             mail: ldap ? ldap.mail || null : null,
        //             date,
        //             message,
        //             branch: repoName.toLowerCase(),
        //             path: scRepo,
        //             repo_type: 'svn',
        //             parents: [lastRevision],
        //             loc: svnDiffData ? svnDiffData.loc || 'NA' : 'NA',
        //             changeFiles: svnDiffData ? svnDiffData.changeFiles || [] : null,
        //             file_changed: svnDiffData ? svnDiffData.fileChanged || 0 : null
        //         };
        //         postCommits.push(commit);
        //         return commitCb();
        //     });
        // });
    }, (err) => {
        if (err) {
            return cb(err);
        }
        return cb(null, {postCommits, lastRevision: newLastRevision, errorArray});
    });
}

function postToCoop(params, cb) {
    const {postCommits, scName, repoName, scRepo, dtRowId} = params;
    if (scName) {
        const url = `${POST_API_URL}${scName}`;
        const info = `Collect log: sc_name = ${scName}, repo_name=${repoName}, sc_repo=${scRepo}`;
        logger.info(info);
        const postCommitsString = qs.stringify(postCommits);
        const postCommitsJsonString = JSON.stringify(postCommits);
        axios.post(url, postCommitsString, AXIOS_OPTION)
            .then(() => {
                logger.info(`Post commits ${postCommitsJsonString} to coop ${scName}`);
                const lastRevisionData = {};
                lastRevisionData['rowid'] = dtRowId;
                lastRevisionData['scantime'] = moment().unix();
                const length = postCommits['commits'].length;
                lastRevisionData['last_revision'] = postCommits['commits'][length - 1]['revision'];
                return cb(null, [lastRevisionData]);
            }, (response) => cb(`${response}\n${postCommitsJsonString}`))
            .catch(cb);
    } else {
        return cb();
    }

}

function postLastRevisions(lastRevisionArray, cb) {
    const postData = {
        action: 'robot',
        data: lastRevisionArray
    };
    const postDataString = qs.stringify(postData);
    const showInfo = JSON.stringify(postData);
    axios.post(REPO_POST_URL, postDataString)
        .then(() => {
            logger.info(`Update last scaned revision to coop: ${showInfo}`);
            return cb();
        }, ({response}) => {
            const {status, data} = response;
            return cb(`${status}\n${data}\n${showInfo}`);
        })
        .catch(cb);
}

function syncSC(params, cb) {
    const {scName, scRepo} = params;
    async.waterfall([(scb) => {
        svnLog(params, scb);
    }, (commits, scb) => {
        params['commits'] = commits;
        handleCommits(params, scb);
    }], (err, commitsData) => {
        let errorArray = [];
        if (err) {
            errorArray.push(err);
            return cb(null,{errorArray});
        }
        const {postCommits} = commitsData;
        errorArray = errorArray.concat(commitsData['errorArray'] || []);
        params['postCommits'] = {commits: postCommits};
        if (postCommits.length) {
            async.waterfall([(postCb) => {
                postToCoop(params, postCb);
            }, (lastRevisionArray, postCb) => {
                if (lastRevisionArray && lastRevisionArray.length) {
                    postLastRevisions(lastRevisionArray, postCb);
                } else {
                    return postCb();
                }
            }], (err) => {
                if (err) {
                    errorArray.push(err);
                }
                return cb(null, {errorArray});
            });
        } else {
            logger.info(`No new commits for ${scName}:${scRepo}`);
            return cb(null, {errorArray});
        }
    });
}

function main(cb = noop) {
    getRepo('robot', (err, data) => {
        if (err) {
            logger.error(err);
            processExit(1);
            return cb(err);
        }
        PASSWD = data.pass;
        const confArray = (data.data || []);
        async.mapLimit(confArray, confArray.length, (confRow, cb) => {
            if (confRow.hasOwnProperty('skipCmd') && confRow.skipCmd) {
                return cb(null, {skipConf: confRow});
            } else if (confRow.hasOwnProperty('sc') && confRow.sc && confRow.hasOwnProperty('repo_name') &&
                confRow.hasOwnProperty('url') && HTTP_REG.test(confRow.url)) {
                const params = {};
                params.scName = confRow.sc;
                params.repoName = confRow.repo_name;
                params.scRepo = confRow.url;
                params.replaceUrl = confRow.replaceUrl || confRow.url;
                params.lastRevision = confRow.last_revision || null;
                params.svnUser = confRow.svn_user || USER;
                params.svnPassword = confRow.svn_password || PASSWD;
                params.dtRowId = confRow._id;
                return syncSC(params, cb);
            }
            return cb(null, {skipConf: confRow});

        }, (err, results) => {
            if (err) {
                logger.error(err);
                logger.error('Failed to synchronize all repos.');

                processExit(1);
                return cb(err);
            }

            let totalErrorArray = [];
            const skipConfArray = [];
            (results || []).forEach((data) => {
                if (data.hasOwnProperty('errorArray') && data.errorArray.length) {
                    totalErrorArray = totalErrorArray.concat(data.errorArray);
                }
                if (data.hasOwnProperty('skipConf')) {
                    skipConfArray.push(data.skipConf);
                }
            });
            // if (skipConfArray.length) {
            //     logger.info(`Can not run executing the following confs.\n${JSON.stringify(skipConfArray)}`);
            // }
            if (totalErrorArray.length) {
                logger.info('Errors during executing sync sc repos.');
                totalErrorArray.forEach((error) => {
                    logger.error(error);
                });
            }
            logger.info('All repos are synchronized.');
            processExit(0);
            return cb(null, results);
        });
    });
}

if (process.env.NODE_ENV !== 'test') {
    main();
}

module.exports.main = main;
module.exports.getRepo = getRepo;
module.exports.svnLog = svnLog;
module.exports.postLastRevisions = postLastRevisions;
module.exports.REPO_GET_URL = REPO_GET_URL;

