#!/usr/bin/perl

# install MinGW/Cygwin:
# bashrc: export GVIM_PATH=c:/Vim/vim91/gvim)
# cp g.pl ~/bin/g
# cp g.pl ~/bin/gvim

use strict;
use warnings;

my $cygwin = $^O eq 'cygwin';
my $msys = $^O eq 'msys';
my $linux = $^O eq 'linux';
my $win32 = !$linux;
my $stdin = 0;
my $fg = 0;
my $GVIM_PATH = $ENV{GVIM_PATH};
if (!$GVIM_PATH){
  $GVIM_PATH = $linux ? 'gvim' : 'c:/Vim/vim91/gvim';
}
my $verbose = 0;

# copy from util/util.pm
sub file_read
{
    my ($file) = (@_);
    if (!open(FILE, "<$file")){
	return ""; }
    my $data = "";
    while (<FILE>){
	$data .= $_; }
    close(FILE);
    return $data;
}

sub _argv_to_shell
{
    my ($arg) = (@_);
    if ($arg =~ /^[-[:alnum:]_\/.,:|' ^]+$/){
	return $arg; }
    $arg =~ s/([\\"`\$])/\\$1/g;
    return "\"$arg\"";
}

sub set_opt
{
    my (@a) = (@_);
    $stdin = grep(/^-$/, @a);
    $fg = grep(/^-f$/, @a);
    # handle jumping to a specific line: g <filename>:<line>:<junk>
    if ($a[0] && $a[0] =~ /^(([a-zA-Z]:)?[^:]+)(:([0-9]+))?(:.*)?$/)
    {
	shift(@a);
	my $file = $1;
	my $lineno = $4;
	push(@a, $file);
	if ($lineno){
	    push(@a, "+$lineno"); }
    }
    # handle on Cygwin converting Unix paths to Windows paths
    my $i;
    if ($cygwin)
    {
	for ($i=0; $i<+@a; $i++)
	{
	    if (-e $a[$i])
	    {
		my $path = `cygpath -w \"$a[$i]\"`;
		chomp $path;
		$path =~ s@\\@/@g;
		$a[$i] = $path;
	    }
	}
    }
    # vim 7.3 linux X-Windows (<ubuntu 14.04) has a problem with height
    # maximization with :set lines=999 since it does limit by screen size.
    # So we set it from command line
    if ($linux && !grep(/^-geometry$/, @a) && $GVIM_PATH =~ /\bgvim\b/)
    {
        my $issue = file_read('/etc/issue');
        if ($issue =~ /^Ubuntu (12.10|13.04|13.10)/){
            unshift(@a, "-geometry", "x999"); }
    }
    return @a;
}

sub run
{
    my (@a) = (@_);
    @a = set_opt(@a); # parse the options for gvim line jump
    my $r = 1;
    my @_a;
    my $i;
    if ($cygwin || $msys){
        # for Cygwin - solve the problem of running GVIM in background
        for ($i=0; $i<+@a; $i++){
            $a[$i] = _argv_to_shell($a[$i]); }
	if ($fg && $stdin){
	    @_a = ("cat | $GVIM_PATH @a"); }
	elsif ($fg && !$stdin){
	    @_a = ($GVIM_PATH, @a); }
	elsif (!$fg && $stdin){
	    @_a = ("cat | $GVIM_PATH @a &"); }
	elsif (!$fg && !$stdin){
	    @_a = ("$GVIM_PATH @a &"); }
	else {
	    die "gvim run error"; }
    } else {
    	@_a = ($GVIM_PATH, @a); } # for Linux - run GVIM with no changes
    if ($verbose){
	print("command line:\n");
	for (my $i=0; $i<+@_a; $i++){
	    print("$i: \"$_a[$i]\"\n"); }
    }
    if ($msys && 0){
        unshift(@_a, "start"); }
    $r = system(@_a); # for Linux - run GVIM with no changes
    return $r;
}

exit(run(@ARGV));
