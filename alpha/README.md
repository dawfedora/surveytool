# surveytool
Tool for recording input for Edgewood wildflower surveys

The trail data and the flora list are specific to Edgewood County Park in San Mateo County, CA.

There is no reason in principle it couldn't be adapted to some other location.

We are deploying the app through Github pages.  Our user base is on the order of 10 people, so the iOS and Android app stores were too much work.

This is a cache-first app.  On a mobile device it is loaded, and then a link is saved to the home screen.  From there it lives in the browser's cache.  So when you go into areas with little or no reception, it will still operate.

It is intended to work on iOS and Android, on a number of browsers.  We have used it with Chrome, Firefox, and Safari.

The current working version is deployed to dawfedora.gihub.io/surveytool
The development version is at dawfedora.github.io/surveytool/dev.  Dev may be broken at any given time, 'cause to test, you need to load it as a webpage.
