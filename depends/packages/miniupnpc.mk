package=miniupnpc
$(package)_version=2.3.7
$(package)_download_path=https://github.com/miniupnp/miniupnp/archive/refs/tags
$(package)_file_name=miniupnp-$($(package)_version).tar.gz
$(package)_sha256_hash=d5558cd419c8d46bdc958064cb97f963d1ea793866414c025906ec15033512ed

define $(package)_set_vars
$(package)_build_opts=CC="$($(package)_cc)"
$(package)_build_opts_darwin=OS=Darwin LIBTOOL="$($(package)_libtool)"
$(package)_build_opts_mingw32=-f Makefile.mingw
$(package)_build_env+=CFLAGS="$($(package)_cflags) $($(package)_cppflags)" AR="$($(package)_ar)"
endef

define $(package)_preprocess_cmds
  mkdir dll && \
  sed -e 's|MINIUPNPC_VERSION_STRING \"version\"|MINIUPNPC_VERSION_STRING \"$($(package)_version)\"|' -e 's|OS/version|$(host)|' miniupnpcstrings.h.in > miniupnpcstrings.h && \
  sed -i.old "s|miniupnpcstrings.h: miniupnpcstrings.h.in wingenminiupnpcstrings|miniupnpcstrings.h: miniupnpcstrings.h.in|" Makefile.mingw && \
  perl -i -pe 's/setsockopt\(sudp, IPPROTO_IPV6, IPV6_MULTICAST_HOPS, \&mcastHops/setsockopt(sudp, IPPROTO_IPV6, IPV6_MULTICAST_HOPS, (const char *)&mcastHops/g' minissdpc.c || true
endef

define $(package)_build_cmds
	$(MAKE) libminiupnpc.a $($(package)_build_opts)
endef

define $(package)_stage_cmds
	mkdir -p $($(package)_staging_prefix_dir)/include/miniupnpc $($(package)_staging_prefix_dir)/lib &&\
	install *.h $($(package)_staging_prefix_dir)/include/miniupnpc &&\
	install libminiupnpc.a $($(package)_staging_prefix_dir)/lib
endef
